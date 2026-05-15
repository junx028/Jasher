const fetch = require('node-fetch');

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_IDS = (process.env.OWNER_IDS || '').split(',').map(id => id.trim());
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@LeguminY';
const DEVELOPER = process.env.DEVELOPER || '@xnecz';
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const VERCEL_URL = 'https://limit-bot.vercel.app';

// ==================== DATABASE ====================
async function getDB() {
    try {
        const res = await fetch(GIST_API, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        const gist = await res.json();
        return JSON.parse(gist.files['database.json'].content);
    } catch (e) { return initDB(); }
}

async function saveDB(db) {
    try {
        await fetch(GIST_API, {
            method: 'PATCH',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: { 'database.json': { content: JSON.stringify(db, null, 2) } } })
        });
    } catch (e) {}
}

function initDB() {
    return {
        users: [],
        groups: [],
        blacklist: [],
        userGroups: {},
        accessExpiry: {},
        autoMessages: {},
        cooldowns: {},
        stats: { totalShares: 0, totalUsers: 0, totalGroups: 0 }
    };
}

// ==================== HELPERS ====================
async function sendMsg(chatId, text, replyMarkup) {
    try {
        const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
        await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        return true;
    } catch (e) { return false; }
}

async function copyMsg(chatId, fromChatId, messageId) {
    try {
        await fetch(`${TELEGRAM_API}/copyMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, from_chat_id: fromChatId, message_id: messageId })
        });
        return true;
    } catch (e) { return false; }
}

async function forwardMsg(chatId, fromChatId, messageId) {
    try {
        await fetch(`${TELEGRAM_API}/forwardMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, from_chat_id: fromChatId, message_id: messageId })
        });
        return true;
    } catch (e) { return false; }
}

async function checkChannel(userId) {
    try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHANNEL_USERNAME, user_id: userId })
        });
        const data = await res.json();
        return ['member', 'administrator', 'creator'].includes(data.result?.status);
    } catch (e) { return false; }
}

function isOwner(userId) { return OWNER_IDS.includes(String(userId)); }

function hasAccess(db, userId) {
    if (isOwner(userId)) return true;
    const expiry = db.accessExpiry?.[String(userId)];
    if (!expiry) return false;
    return Date.now() < expiry;
}

function getAccessExpiry(userId) {
    const db = getDB();
    const exp = db.accessExpiry?.[String(userId)];
    if (!exp) return 'Tidak punya akses';
    const d = new Date(exp);
    return d.toLocaleString('id-ID');
}

function progressBar(p) {
    const f = Math.round(p / 10);
    return `[${'█'.repeat(f)}${'░'.repeat(10 - f)}] ${p}%`;
}

// ==================== AUTO SHARE STORAGE ====================
const autoShares = {};

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(200).json({ status: 'OK', message: 'Jasher Bot Active', developer: DEVELOPER });
    }

    const body = req.body;
    const db = await getDB();

    // ==================== CALLBACK QUERY ====================
    if (body.callback_query) {
        const q = body.callback_query;
        const data = q.data;
        const chatId = q.message.chat.id;
        const userId = q.from.id;
        const messageId = q.message.message_id;

        try {
            await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: q.id })
            });
        } catch (e) {}

        // Check join channel
        if (data === 'check_join') {
            if (await checkChannel(userId)) {
                await sendMsg(chatId, '✅ Berhasil join!\n\nSekarang ketik /start untuk mulai.');
            } else {
                await sendMsg(chatId, '❌ Kamu masih belum join channel!', {
                    inline_keyboard: [
                        [{ text: '📢 Join Channel', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }],
                        [{ text: '🔄 Cek Ulang', callback_data: 'check_join' }]
                    ]
                });
            }
            return res.status(200).json({ status: 'OK' });
        }

        // Share copy
        if (data.startsWith('share_copy_')) {
            const [, , fromChatId, replyMsgId, ownerId] = data.split('_');
            if (String(userId) !== ownerId) return res.status(200).json({ status: 'OK' });

            if (!hasAccess(db, userId)) {
                await sendMsg(chatId, '⏰ Akses kamu sudah expired!\nTambahkan bot ke 1 grup lagi untuk perpanjang 3 hari.');
                return res.status(200).json({ status: 'OK' });
            }

            const groups = db.groups || [];
            if (!groups.length) { await sendMsg(chatId, '❌ Belum ada grup terdaftar!'); return res.status(200).json({ status: 'OK' }); }

            let ok = 0, fail = 0;
            const statusMsg = await sendMsg(chatId, '📡 Memulai share...');

            for (let i = 0; i < groups.length; i++) {
                (await copyMsg(groups[i], fromChatId, parseInt(replyMsgId))) ? ok++ : fail++;
                if ((i + 1) % 5 === 0 || i === groups.length - 1) {
                    const pct = Math.round(((i + 1) / groups.length) * 100);
                    try {
                        await fetch(`${TELEGRAM_API}/editMessageText`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: chatId,
                                message_id: statusMsg?.result?.message_id || messageId,
                                text: `📡 Share Progress\n\n✅ ${ok} | ❌ ${fail}\n${progressBar(pct)}\n\n${i + 1}/${groups.length} grup`,
                                parse_mode: 'HTML'
                            })
                        });
                    } catch (e) {}
                }
                await new Promise(r => setTimeout(r, 300));
            }

            db.stats.totalShares += ok;
            await saveDB(db);
            return res.status(200).json({ status: 'OK' });
        }

        // Share forward
        if (data.startsWith('share_forward_')) {
            const [, , fromChatId, replyMsgId, ownerId] = data.split('_');
            if (String(userId) !== ownerId) return res.status(200).json({ status: 'OK' });

            if (!hasAccess(db, userId)) {
                await sendMsg(chatId, '⏰ Akses kamu sudah expired!\nTambahkan bot ke 1 grup lagi untuk perpanjang 3 hari.');
                return res.status(200).json({ status: 'OK' });
            }

            const groups = db.groups || [];
            if (!groups.length) { await sendMsg(chatId, '❌ Belum ada grup terdaftar!'); return res.status(200).json({ status: 'OK' }); }

            let ok = 0, fail = 0;
            for (let i = 0; i < groups.length; i++) {
                (await forwardMsg(groups[i], fromChatId, parseInt(replyMsgId))) ? ok++ : fail++;
                if ((i + 1) % 10 === 0 || i === groups.length - 1) {
                    await sendMsg(chatId, `📡 Forward ${i + 1}/${groups.length}\n✅ ${ok} | ❌ ${fail}`);
                }
                await new Promise(r => setTimeout(r, 300));
            }
            db.stats.totalShares += ok;
            await saveDB(db);
            return res.status(200).json({ status: 'OK' });
        }

        return res.status(200).json({ status: 'OK' });
    }

    // ==================== MESSAGE HANDLER ====================
    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username || msg.from.first_name || 'User';

        // ==================== BOT DITAMBAHKAN KE GRUP ====================
        if (msg.new_chat_members || msg.group_chat_created) {
            const newMembers = msg.new_chat_members || [];
            const botAdded = newMembers.some(m => m.is_bot && m.username === (body?.result?.username || ''));
            
            if (botAdded || msg.group_chat_created) {
                const adderId = msg.from.id;
                
                if (!db.groups) db.groups = [];
                if (!db.groups.includes(String(chatId))) {
                    db.groups.push(String(chatId));
                    db.stats.totalGroups = db.groups.length;
                }

                // Kasih akses 3 hari ke yang nambahin
                if (!db.userGroups) db.userGroups = {};
                if (!db.userGroups[String(adderId)]) db.userGroups[String(adderId)] = [];
                if (!db.userGroups[String(adderId)].includes(String(chatId))) {
                    db.userGroups[String(adderId)].push(String(chatId));
                }

                const threeDays = 3 * 24 * 60 * 60 * 1000;
                const currentExpiry = db.accessExpiry?.[String(adderId)] || Date.now();
                db.accessExpiry[String(adderId)] = Math.max(currentExpiry, Date.now()) + threeDays;
                
                await saveDB(db);

                const expDate = new Date(db.accessExpiry[String(adderId)]).toLocaleString('id-ID');
                await sendMsg(chatId, 
                    `✅ <b>Bot berhasil ditambahkan!</b>\n\n` +
                    `👤 <a href="tg://user?id=${adderId}">${msg.from.first_name}</a> dapat akses <b>3 hari</b>!\n` +
                    `⏰ Berlaku sampai: ${expDate}\n\n` +
                    `📊 Grup ini terdaftar untuk share.\n` +
                    `Ketik /start di private chat untuk mulai.`
                );

                try {
                    await sendMsg(adderId,
                        `🎉 <b>Akses Diberikan!</b>\n\n` +
                        `Kamu menambahkan bot ke grup: <b>${msg.chat.title || 'Grup'}</b>\n` +
                        `⏰ Akses fitur share: <b>3 hari</b>\n` +
                        `📅 Berlaku sampai: ${expDate}\n\n` +
                        `Gunakan /sharemsg untuk mulai share!`
                    );
                } catch (e) {}

                return res.status(200).json({ status: 'OK' });
            }
        }

        // ==================== BOT DIKELUARKAN DARI GRUP ====================
        if (msg.left_chat_member) {
            if (msg.left_chat_member.is_bot) {
                if (db.groups) {
                    db.groups = db.groups.filter(g => g !== String(chatId));
                    db.stats.totalGroups = db.groups.length;
                    await saveDB(db);
                }
                return res.status(200).json({ status: 'OK' });
            }
        }

        // ==================== REGISTER USER ====================
        if (!db.users) db.users = [];
        if (!db.users.includes(String(userId))) {
            db.users.push(String(userId));
            db.stats.totalUsers = db.users.length;
            await saveDB(db);
        }

        // ==================== BLACKLIST CHECK ====================
        if ((db.blacklist || []).includes(String(userId))) {
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /start ====================
        if (text === '/start') {
            if (!(await checkChannel(userId))) {
                return sendMsg(chatId,
                    `⚠️ <b>Akses Ditolak!</b>\n\n` +
                    `Kamu wajib join channel:\n📢 <b>${CHANNEL_USERNAME}</b>\n\n` +
                    `Setelah join, klik Cek Ulang 👇`,
                    {
                        inline_keyboard: [
                            [{ text: '📢 Join Channel', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }],
                            [{ text: '🔄 Cek Ulang', callback_data: 'check_join' }]
                        ]
                    }
                );
            }

            const own = isOwner(userId);
            const access = hasAccess(db, userId);
            const userGroupCount = (db.userGroups?.[String(userId)] || []).length;
            const expiry = db.accessExpiry?.[String(userId)] 
                ? new Date(db.accessExpiry[String(userId)]).toLocaleString('id-ID')
                : 'Belum punya';

            let accessInfo = '';
            if (own) {
                accessInfo = '👑 <b>Owner</b> — Akses permanen';
            } else if (access) {
                accessInfo = `✅ <b>Aktif</b> — Berlaku sampai ${expiry}`;
            } else {
                accessInfo = '❌ <b>Tidak Aktif</b> — Tambah bot ke 1 grup untuk dapat akses 3 hari';
            }

            await sendMsg(chatId,
                `🤖 <b>JASHER BOT</b>\n\n` +
                `👋 Welcome, ${username}!\n\n` +
                `📊 <b>Status:</b>\n` +
                `├ ${accessInfo}\n` +
                `├ Grup ditambah: ${userGroupCount}\n` +
                `├ Total Users: ${db.users.length}\n` +
                `└ Total Groups: ${(db.groups || []).length}\n\n` +
                `🔹 <b>Command:</b>\n` +
                `/sharemsg — Share ke grup\n` +
                `/broadcast — Broadcast (Owner)\n` +
                `/setpesan — Simpan auto pesan\n` +
                `/auto on/off — Auto share\n` +
                `/status — Cek status akses\n` +
                `/owner — Menu Owner\n` +
                `/help — Bantuan\n\n` +
                `⚠️ <b>Syarat Akses:</b>\n` +
                `Tambah bot ke 1 grup = Akses 3 hari\n\n` +
                `👨‍💻 ${DEVELOPER}`
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /help ====================
        if (text === '/help') {
            await sendMsg(chatId,
                `📋 <b>BANTUAN</b>\n\n` +
                `<b>Perintah:</b>\n` +
                `/start — Menu utama\n` +
                `/sharemsg — Share pesan ke grup\n` +
                `/broadcast — Broadcast ke user (Owner)\n` +
                `/setpesan — Simpan pesan untuk auto\n` +
                `/auto on/off — Auto share\n` +
                `/status — Cek status akses\n` +
                `/owner — Menu Owner\n\n` +
                `<b>Syarat Akses:</b>\n` +
                `➕ Tambah bot ke 1 grup = 3 hari akses\n` +
                `⏰ Expired? Tambah lagi!\n\n` +
                `📢 ${CHANNEL_USERNAME}`
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /status ====================
        if (text === '/status') {
            if (!(await checkChannel(userId))) return sendMsg(chatId, '⚠️ Join channel dulu!');

            const own = isOwner(userId);
            const access = hasAccess(db, userId);
            const userGroups = db.userGroups?.[String(userId)] || [];
            const expiry = db.accessExpiry?.[String(userId)]
                ? new Date(db.accessExpiry[String(userId)]).toLocaleString('id-ID')
                : 'Belum punya akses';
            const remaining = db.accessExpiry?.[String(userId)]
                ? Math.max(0, Math.ceil((db.accessExpiry[String(userId)] - Date.now()) / (1000 * 60 * 60 * 24)))
                : 0;

            await sendMsg(chatId,
                `📊 <b>STATUS AKSES</b>\n\n` +
                `👤 User: ${username}\n` +
                `👑 Owner: ${own ? 'Ya' : 'Tidak'}\n` +
                `✅ Akses: ${own ? 'Permanen' : (access ? 'Aktif' : 'Tidak Aktif')}\n` +
                `📅 Expiry: ${own ? 'Selamanya' : expiry}\n` +
                `⏳ Sisa: ${own ? '∞' : remaining + ' hari'}\n` +
                `📢 Grup ditambah: ${userGroups.length}\n\n` +
                `💡 ${!access && !own ? 'Tambah bot ke 1 grup untuk dapat akses 3 hari!' : ''}`
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /sharemsg ====================
        if (text === '/sharemsg') {
            if (!(await checkChannel(userId))) return sendMsg(chatId, '⚠️ Join channel dulu!');
            if (!hasAccess(db, userId)) {
                return sendMsg(chatId,
                    `⏰ <b>Akses Expired!</b>\n\n` +
                    `Tambahkan bot ke <b>1 grup</b> untuk dapat akses <b>3 hari</b>.\n\n` +
                    `Cara: Invite @${body?.result?.username || 'bot'} ke grup kamu.`
                );
            }
            if (!msg.reply_to_message) return sendMsg(chatId, '⚠️ Reply pesan yang mau di-share!');

            const keyboard = {
                inline_keyboard: [
                    [{ text: '📤 Copy Message', callback_data: `share_copy_${chatId}_${msg.reply_to_message.message_id}_${userId}` }]
                ]
            };

            if (isOwner(userId)) {
                keyboard.inline_keyboard.push([
                    { text: '📎 Forward Message', callback_data: `share_forward_${chatId}_${msg.reply_to_message.message_id}_${userId}` }
                ]);
            }

            await sendMsg(chatId, '📤 Pilih mode share:', keyboard);
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /broadcast (Owner) ====================
        if (text === '/broadcast') {
            if (!isOwner(userId)) return sendMsg(chatId, '❌ Hanya Owner!');
            if (!msg.reply_to_message) return sendMsg(chatId, '⚠️ Reply pesan!');

            const users = db.users || [];
            if (!users.length) return sendMsg(chatId, '❌ Belum ada user!');

            let ok = 0, fail = 0;
            const replyId = msg.reply_to_message.message_id;
            const statusMsg = await sendMsg(chatId, '📡 Broadcast 0/' + users.length);

            for (let i = 0; i < users.length; i++) {
                (await copyMsg(users[i], chatId, replyId)) ? ok++ : fail++;
                if ((i + 1) % 10 === 0 || i === users.length - 1) {
                    try {
                        await fetch(`${TELEGRAM_API}/editMessageText`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: chatId,
                                message_id: statusMsg?.result?.message_id,
                                text: `📡 Broadcast ${i + 1}/${users.length}\n✅ ${ok} | ❌ ${fail}`,
                                parse_mode: 'HTML'
                            })
                        });
                    } catch (e) {}
                }
                await new Promise(r => setTimeout(r, 300));
            }

            db.stats.totalShares += ok;
            await saveDB(db);
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /setpesan ====================
        if (text === '/setpesan') {
            if (!(await checkChannel(userId))) return sendMsg(chatId, '⚠️ Join channel dulu!');
            if (!hasAccess(db, userId)) return sendMsg(chatId, '⏰ Akses expired! Tambah bot ke grup dulu.');
            if (!msg.reply_to_message) return sendMsg(chatId, '⚠️ Reply pesan yang mau disimpan!');

            if (!db.autoMessages) db.autoMessages = {};
            db.autoMessages[String(userId)] = { chatId, messageId: msg.reply_to_message.message_id };
            await saveDB(db);
            await sendMsg(chatId, '✅ Pesan disimpan!\nSekarang gunakan /auto on untuk mulai auto share.');
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /auto ====================
        if (text.startsWith('/auto')) {
            if (!(await checkChannel(userId))) return sendMsg(chatId, '⚠️ Join channel dulu!');
            if (!hasAccess(db, userId)) return sendMsg(chatId, '⏰ Akses expired! Tambah bot ke grup dulu.');

            const arg = text.replace('/auto', '').trim().toLowerCase();
            const saved = db.autoMessages?.[String(userId)];

            if (arg === 'on') {
                if (!saved) return sendMsg(chatId, '⚠️ Simpan pesan dulu dengan /setpesan!');
                autoShares[String(userId)] = {
                    active: true,
                    chatId: saved.chatId,
                    messageId: saved.messageId,
                    lastSent: 0,
                    round: 0
                };
                await sendMsg(chatId, '✅ Auto share <b>AKTIF</b>!\nBot akan share otomatis setiap 1 menit.');
            } else if (arg === 'off') {
                delete autoShares[String(userId)];
                await sendMsg(chatId, '❌ Auto share <b>MATI</b>!');
            } else {
                const active = autoShares[String(userId)]?.active;
                await sendMsg(chatId, `📊 Auto Share: ${active ? '🟢 AKTIF' : '🔴 MATI'}`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /owner ====================
        if (text === '/owner') {
            if (!isOwner(userId)) return sendMsg(chatId, '❌ Hanya Owner!');

            await sendMsg(chatId,
                `👑 <b>OWNER MENU</b>\n\n` +
                `📊 <b>Stats:</b>\n` +
                `├ Users: ${db.users.length}\n` +
                `├ Groups: ${(db.groups || []).length}\n` +
                `└ Shares: ${db.stats?.totalShares || 0}\n\n` +
                `<b>Commands:</b>\n` +
                `/broadcast — Broadcast ke user\n` +
                `/addowner ID — Tambah owner\n` +
                `/removeowner ID — Hapus owner\n` +
                `/blacklist ID — Blacklist user\n` +
                `/unblacklist ID — Unblacklist\n` +
                `/addgroup ID — Tambah grup\n` +
                `/removegroup ID — Hapus grup\n` +
                `/listgroups — List grup\n` +
                `/giveaccess ID — Kasih akses 3 hari\n` +
                `/revokeaccess ID — Cabut akses\n` +
                `/backup — Backup database\n\n` +
                `👨‍💻 ${DEVELOPER}`
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== OWNER COMMANDS ====================
        if (text.startsWith('/addowner') && isOwner(userId)) {
            const id = text.replace('/addowner', '').trim();
            if (id && !OWNER_IDS.includes(id)) {
                OWNER_IDS.push(id);
                await sendMsg(chatId, `✅ ${id} sekarang Owner!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/removeowner') && isOwner(userId)) {
            const id = text.replace('/removeowner', '').trim();
            const idx = OWNER_IDS.indexOf(id);
            if (idx > 0) {
                OWNER_IDS.splice(idx, 1);
                await sendMsg(chatId, `✅ ${id} dihapus dari Owner!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/blacklist') && isOwner(userId)) {
            const id = text.replace('/blacklist', '').trim();
            if (!db.blacklist) db.blacklist = [];
            if (id && !db.blacklist.includes(id)) {
                db.blacklist.push(id);
                await saveDB(db);
                await sendMsg(chatId, `✅ ${id} diblacklist!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/unblacklist') && isOwner(userId)) {
            const id = text.replace('/unblacklist', '').trim();
            if (db.blacklist) {
                db.blacklist = db.blacklist.filter(x => x !== id);
                await saveDB(db);
                await sendMsg(chatId, `✅ ${id} diunblacklist!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/addgroup') && isOwner(userId)) {
            const id = text.replace('/addgroup', '').trim();
            if (!db.groups) db.groups = [];
            if (id && !db.groups.includes(id)) {
                db.groups.push(id);
                db.stats.totalGroups = db.groups.length;
                await saveDB(db);
                await sendMsg(chatId, `✅ Grup ${id} ditambah!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/removegroup') && isOwner(userId)) {
            const id = text.replace('/removegroup', '').trim();
            if (db.groups) {
                db.groups = db.groups.filter(g => g !== id);
                db.stats.totalGroups = db.groups.length;
                await saveDB(db);
                await sendMsg(chatId, `✅ Grup ${id} dihapus!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text === '/listgroups' && isOwner(userId)) {
            const groups = db.groups || [];
            const list = groups.slice(-20).map((g, i) => `${i + 1}. <code>${g}</code>`).join('\n');
            await sendMsg(chatId, `📋 <b>List Grup</b> (${groups.length})\n\n${list || 'Kosong'}`);
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/giveaccess') && isOwner(userId)) {
            const id = text.replace('/giveaccess', '').trim();
            if (id) {
                const threeDays = 3 * 24 * 60 * 60 * 1000;
                const current = db.accessExpiry?.[id] || Date.now();
                db.accessExpiry[id] = Math.max(current, Date.now()) + threeDays;
                await saveDB(db);
                const exp = new Date(db.accessExpiry[id]).toLocaleString('id-ID');
                await sendMsg(chatId, `✅ Akses 3 hari diberikan ke ${id}!\n📅 Expiry: ${exp}`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/revokeaccess') && isOwner(userId)) {
            const id = text.replace('/revokeaccess', '').trim();
            if (id && db.accessExpiry?.[id]) {
                delete db.accessExpiry[id];
                await saveDB(db);
                await sendMsg(chatId, `✅ Akses ${id} dicabut!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text === '/backup' && isOwner(userId)) {
            const backup = JSON.stringify(db, null, 2);
            try {
                await fetch(`${TELEGRAM_API}/sendDocument`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        document: `data:text/json;base64,${Buffer.from(backup).toString('base64')}`,
                        caption: `📅 Backup ${new Date().toISOString()}\n👥 ${db.users.length} users\n📢 ${(db.groups||[]).length} groups`,
                        file_name: `backup_${Date.now()}.json`
                    })
                });
            } catch (e) {
                await sendMsg(chatId, '❌ Gagal backup!');
            }
            return res.status(200).json({ status: 'OK' });
        }

        return res.status(200).json({ status: 'OK' });
    }

    res.status(200).json({ status: 'OK' });
};

// ==================== AUTO SHARE LOOP ====================
setInterval(async () => {
    try {
        const db = await getDB();
        const groups = db.groups || [];
        if (!groups.length) return;

        for (const [userId, config] of Object.entries(autoShares)) {
            if (!config.active) continue;
            if (!hasAccess(db, userId)) {
                delete autoShares[userId];
                continue;
            }

            const now = Date.now();
            if (now - config.lastSent < 60000) continue;

            config.lastSent = now;
            config.round++;

            let ok = 0;
            for (const groupId of groups) {
                if (await copyMsg(groupId, config.chatId, config.messageId)) ok++;
                await new Promise(r => setTimeout(r, 300));
            }

            db.stats.totalShares += ok;
            await saveDB(db);

            try {
                await sendMsg(userId, `🔄 Auto Share #${config.round}\n✅ ${ok}/${groups.length} grup`);
            } catch (e) {}
        }
    } catch (e) {}
}, 30000);
