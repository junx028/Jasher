const fetch = require('node-fetch');

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_ID = BOT_TOKEN ? BOT_TOKEN.split(':')[0] : ''; 

const OWNER_IDS = (process.env.OWNER_IDS || '').split(',').map(id => id.trim());
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@LeguminY';
const DEVELOPER = process.env.DEVELOPER || '@xnecz';
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const VERCEL_URL = 'https://veldora-jasher.vercel.app';

// ==================== FAKE STATS SETTINGS ====================
const FAKE_USERS = 560;
const FAKE_GROUPS = 247;

// ==================== DATABASE ====================
async function getDB() {
    try {
        const res = await fetch(GIST_API, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        
        if (!res.ok) {
            console.error("Gist Fetch Failed! HTTP Status:", res.status);
            return initDB();
        }
        
        const gist = await res.json();
        if (!gist.files || !gist.files['database.json']) {
            return initDB();
        }
        
        return JSON.parse(gist.files['database.json'].content);
    } catch (error) { 
        console.error("Error getDB:", error.message);
        return initDB(); 
    }
}

async function saveDB(db) {
    try {
        await fetch(GIST_API, {
            method: 'PATCH',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: { 'database.json': { content: JSON.stringify(db, null, 2) } } })
        });
    } catch (error) {
        console.error("Error saveDB:", error.message);
    }
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
async function sendMsg(chatId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        
        const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        return data;
    } catch (error) { 
        return false; 
    }
}

async function copyMsg(chatId, fromChatId, messageId) {
    try {
        await fetch(`${TELEGRAM_API}/copyMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, from_chat_id: fromChatId, message_id: messageId })
        });
        return true;
    } catch (error) { return false; }
}

async function forwardMsg(chatId, fromChatId, messageId) {
    try {
        await fetch(`${TELEGRAM_API}/forwardMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, from_chat_id: fromChatId, message_id: messageId })
        });
        return true;
    } catch (error) { return false; }
}

async function checkChannel(userId) {
    try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHANNEL_USERNAME, user_id: userId })
        });
        const data = await res.json();
        if (!data.ok) return true; 
        
        return ['member', 'administrator', 'creator'].includes(data.result?.status);
    } catch (error) { 
        return true; 
    }
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

    // ==================== 1. DETEKSI BOT DITAMBAHKAN KE GRUP ====================
    if (body.my_chat_member) {
        const myMember = body.my_chat_member;
        const chatId = myMember.chat.id;
        const chatTitle = myMember.chat.title || 'Grup';
        const newStatus = myMember.new_chat_member.status;
        const adderId = myMember.from.id;
        
        if (['member', 'administrator'].includes(newStatus)) {
            if (!db.groups) db.groups = [];
            if (!db.groups.includes(String(chatId))) {
                db.groups.push(String(chatId));
                db.stats.totalGroups = db.groups.length;

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
                    `✅ <b>Terima kasih sudah mengundang bot ke ${chatTitle}!</b>\n\n` +
                    `👤 Spesial untuk pengundang (<a href="tg://user?id=${adderId}">Klik Disini</a>):\n` +
                    `Kamu otomatis mendapatkan VIP Akses <b>3 Hari</b> untuk Share Massal!\n` +
                    `⏰ Berlaku sampai: ${expDate}\n\n` +
                    `Silakan kembali ke Private Chat Bot dan ketik /start untuk menggunakan fitur.`
                );

                try {
                    await sendMsg(adderId,
                        `🎉 <b>Akses VIP Share Diberikan!</b>\n\n` +
                        `Terima kasih telah menambahkan bot ke grup <b>${chatTitle}</b>\n` +
                        `⏰ Kamu mendapat tambahan akses: <b>3 hari</b>\n` +
                        `📅 Total masa aktif sampai: ${expDate}\n\n` +
                        `Gunakan perintah <code>/sharemsg</code> di chat ini untuk mulai sebar iklanmu!`
                    );
                } catch (error) {}
            }
        } else if (['left', 'kicked'].includes(newStatus)) {
            if (db.groups && db.groups.includes(String(chatId))) {
                db.groups = db.groups.filter(g => g !== String(chatId));
                db.stats.totalGroups = db.groups.length;
                await saveDB(db);
            }
        }
        return res.status(200).json({ status: 'OK' });
    }

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
        } catch (error) {}

        if (data === 'check_join') {
            if (await checkChannel(userId)) {
                await sendMsg(chatId, '✅ Berhasil memverifikasi!\n\nSilakan ketik /start untuk membuka menu utama.');
            } else {
                await sendMsg(chatId, '❌ Kamu masih belum terdeteksi join di channel kami!', {
                    inline_keyboard: [
                        [{ text: '📢 Join Channel', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }],
                        [{ text: '🔄 Cek Ulang', callback_data: 'check_join' }]
                    ]
                });
            }
            return res.status(200).json({ status: 'OK' });
        }

        // ==============================================================
        // PERBAIKAN BUG LAG: SHARE COPY BERJALAN DI BACKGROUND TUGAS
        // ==============================================================
        if (data.startsWith('share_copy_')) {
            const [, , fromChatId, replyMsgId, ownerId] = data.split('_');
            if (String(userId) !== ownerId) return res.status(200).json({ status: 'OK' });

            if (!hasAccess(db, userId)) {
                await sendMsg(chatId, '⏰ <b>Akses kamu sudah habis!</b>\nSilakan tambahkan bot ini ke 1 grup baru untuk memperpanjang durasi akses selama 3 hari.');
                return res.status(200).json({ status: 'OK' });
            }

            const groups = db.groups || [];
            if (!groups.length) { 
                await sendMsg(chatId, '❌ Belum ada grup yang terdaftar di database bot!'); 
                return res.status(200).json({ status: 'OK' }); 
            }

            const statusMsg = await sendMsg(chatId, '📡 Sedang memulai proses share massal (Background Process)...');

            // 1. JAWAB TELEGRAM SEKARANG JUGA AGAR TIDAK MACET/TIMEOUT
            res.status(200).json({ status: 'OK' });

            // 2. JALANKAN PROSES LAMA SECARA ASYNCHRONOUS DI BELAKANG LAYAR
            (async () => {
                let ok = 0, fail = 0;
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
                                    text: `📡 <b>Progres Share Manual</b>\n\n✅ Berhasil: ${ok} | ❌ Gagal: ${fail}\n${progressBar(pct)}\n\n⏳ Dikirim ke: ${i + 1}/${groups.length} grup`,
                                    parse_mode: 'HTML'
                                })
                            });
                        } catch (error) {}
                    }
                    await new Promise(r => setTimeout(r, 350));
                }
                db.stats.totalShares += ok;
                await saveDB(db);
                
                await sendMsg(chatId, `🎉 <b>Share Massal Selesai!</b>\nPesan berhasil dikirim ke ${ok} grup.`);
            })();
            
            return; // Hentikan eksekusi kode utama karena response sudah dikirim di atas
        }

        // ==============================================================
        // PERBAIKAN BUG LAG: SHARE FORWARD BERJALAN DI BACKGROUND
        // ==============================================================
        if (data.startsWith('share_forward_')) {
            const [, , fromChatId, replyMsgId, ownerId] = data.split('_');
            if (String(userId) !== ownerId) return res.status(200).json({ status: 'OK' });

            if (!hasAccess(db, userId)) {
                await sendMsg(chatId, '⏰ <b>Akses kamu sudah habis!</b>\nSilakan tambahkan bot ini ke 1 grup baru untuk memperpanjang durasi akses selama 3 hari.');
                return res.status(200).json({ status: 'OK' });
            }

            const groups = db.groups || [];
            if (!groups.length) { 
                await sendMsg(chatId, '❌ Belum ada grup yang terdaftar!'); 
                return res.status(200).json({ status: 'OK' }); 
            }

            const statusMsg = await sendMsg(chatId, '📡 Sedang memulai proses forward massal...');

            // 1. JAWAB TELEGRAM SEKARANG JUGA
            res.status(200).json({ status: 'OK' });

            // 2. PROSES BELAKANG LAYAR
            (async () => {
                let ok = 0, fail = 0;
                for (let i = 0; i < groups.length; i++) {
                    (await forwardMsg(groups[i], fromChatId, parseInt(replyMsgId))) ? ok++ : fail++;
                    
                    if ((i + 1) % 5 === 0 || i === groups.length - 1) {
                        const pct = Math.round(((i + 1) / groups.length) * 100);
                        try {
                            await fetch(`${TELEGRAM_API}/editMessageText`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: chatId,
                                    message_id: statusMsg?.result?.message_id || messageId,
                                    text: `📡 <b>Progres Forward</b>\n\n✅ Berhasil: ${ok} | ❌ Gagal: ${fail}\n${progressBar(pct)}\n\n⏳ Dikirim ke: ${i + 1}/${groups.length} grup`,
                                    parse_mode: 'HTML'
                                })
                            });
                        } catch (error) {}
                    }
                    await new Promise(r => setTimeout(r, 350));
                }
                db.stats.totalShares += ok;
                await saveDB(db);
            })();

            return;
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
        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

        if (msg.new_chat_members || msg.group_chat_created) {
            const newMembers = msg.new_chat_members || [];
            const botAdded = newMembers.some(m => String(m.id) === String(BOT_ID));
            
            if (botAdded || msg.group_chat_created) {
                const adderId = msg.from.id;
                
                if (!db.groups) db.groups = [];
                if (!db.groups.includes(String(chatId))) {
                    db.groups.push(String(chatId));
                    db.stats.totalGroups = db.groups.length;

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
                    await sendMsg(chatId, `✅ <b>Bot Siap Digunakan!</b>\n\n👤 Pengundang mendapat VIP 3 Hari sampai: ${expDate}\nKetik /start di PM untuk memakai bot.`);
                }
                return res.status(200).json({ status: 'OK' });
            }
        }

        // DETEKSI PASIF GRUP BARU
        if (isGroup && text.startsWith('/')) {
            if (!db.groups) db.groups = [];
            if (!db.groups.includes(String(chatId))) {
                db.groups.push(String(chatId));
                db.stats.totalGroups = db.groups.length;
                await saveDB(db);
            }
        }

        if (isGroup) return res.status(200).json({ status: 'OK' });

        // REGISTER USER
        if (!db.users) db.users = [];
        if (!db.users.includes(String(userId))) {
            db.users.push(String(userId));
            db.stats.totalUsers = db.users.length;
            await saveDB(db);
        }

        // BLACKLIST CHECK
        if ((db.blacklist || []).includes(String(userId))) {
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /start ====================
        if (text === '/start') {
            if (!(await checkChannel(userId))) {
                await sendMsg(chatId,
                    `⚠️ <b>Akses Tertutup!</b>\n\n` +
                    `Sistem mendeteksi kamu belum bergabung di saluran resmi kami.\n` +
                    `📢 Wajib Join: <b>${CHANNEL_USERNAME}</b>\n\n` +
                    `Setelah join channel, silakan klik tombol verifikasi di bawah ini 👇`,
                    {
                        inline_keyboard: [
                            [{ text: '📢 Join Channel Sekarang', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }],
                            [{ text: '🔄 Verifikasi / Cek Ulang', callback_data: 'check_join' }]
                        ]
                    }
                );
                return res.status(200).json({ status: 'OK' });
            }

            const own = isOwner(userId);
            const access = hasAccess(db, userId);
            const userGroupCount = (db.userGroups?.[String(userId)] || []).length;
            const expiry = db.accessExpiry?.[String(userId)] 
                ? new Date(db.accessExpiry[String(userId)]).toLocaleString('id-ID')
                : 'Belum punya akses';

            let accessInfo = '';
            if (own) {
                accessInfo = '👑 <b>Developer / Owner</b> (Tanpa Batas)';
            } else if (access) {
                accessInfo = `✅ <b>Aktif</b> (s.d ${expiry})`;
            } else {
                accessInfo = '❌ <b>Tidak Aktif</b> (Tambahkan bot ke 1 grup untuk 3 hari akses)';
            }

            const displayUsers = db.users.length + FAKE_USERS;
            const displayGroups = (db.groups || []).length + FAKE_GROUPS;

            await sendMsg(chatId,
                `🤖 <b>JASHER BOT - AUTO SHARE & FORWARD</b>\n\n` +
                `Halo, <b>${username}</b>! 👋\n` +
                `Bot ini diciptakan khusus untuk membantu kamu membagikan pesan promosi, iklan, atau informasi (teks, foto, video) secara massal ke ratusan grup Telegram hanya dengan sekali klik.\n\n` +
                `=============================\n` +
                `📖 <b>PANDUAN & FUNGSI COMMAND</b>\n` +
                `=============================\n` +
                `🔹 <b>/sharemsg</b> — <i>(Share Manual)</i>\n` +
                `↳ Reply/balas pesan apa saja milikmu dengan command ini, lalu bot akan membagikannya ke semua grup terdaftar seketika.\n\n` +
                `🔹 <b>/setpesan</b> — <i>(Simpan Format)</i>\n` +
                `↳ Reply pesan iklan utamamu dengan command ini. Pesan tersebut akan masuk ke memori bot untuk digunakan pada mode Auto Share.\n\n` +
                `🔹 <b>/auto on</b> atau <b>/auto off</b> — <i>(Mode Otomatis)</i>\n` +
                `↳ Hidupkan ini jika kamu ingin bot mengirimkan pesan yang sudah kamu simpan (via /setpesan) terus-menerus ke semua grup secara otomatis setiap beberapa menit.\n\n` +
                `🔹 <b>/status</b> — <i>(Cek VIP)</i>\n` +
                `↳ Tampilkan sisa durasi langganan/VIP dan daftar partisipasimu.\n\n` +
                `=============================\n` +
                `📊 <b>STATUS AKUN KAMU</b>\n` +
                `├ Hak Akses: ${accessInfo}\n` +
                `├ Kontribusi Grup: ${userGroupCount} Grup\n` +
                `├ Total Server User: ${displayUsers}\n` +
                `└ Total Database Grup: ${displayGroups}\n\n` +
                `⚠️ <b>TIPS:</b> Ingin akses gratis? Cukup masukkan bot ini ke dalam 1 Grup obrolan, kamu akan otomatis diberi akses selama 3 Hari!\n\n` +
                `👨‍💻 Developer: ${DEVELOPER}`
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /help ====================
        if (text === '/help') {
            await sendMsg(chatId,
                `📋 <b>BANTUAN SINGKAT</b>\n\n` +
                `1. Siapkan pesan promosimu.\n` +
                `2. Ketik /setpesan dengan me-reply pesan tersebut agar tersimpan.\n` +
                `3. Ketik /auto on untuk membiarkan bot bekerja sebar pesan 24 jam.\n\n` +
                `Atau jika mau sebar sekali saja (Manual):\n` +
                `Reply pesanmu dengan /sharemsg lalu pilih tombol Broadcast.\n\n` +
                `📢 Jangan lupa support channel kami: ${CHANNEL_USERNAME}`
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /status ====================
        if (text === '/status') {
            if (!(await checkChannel(userId))) return sendMsg(chatId, '⚠️ Mohon selesaikan verifikasi Join Channel dengan ketik /start');

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
                `📊 <b>STATUS KEPEMILIKAN AKSES</b>\n\n` +
                `👤 Nama: ${username}\n` +
                `👑 Tier: ${own ? 'Owner/Admin' : 'Member'}\n` +
                `✅ Status Akses: ${own ? 'Permanen' : (access ? 'Aktif' : 'Tidak Aktif')}\n` +
                `📅 Kedaluwarsa pada: ${own ? 'Selamanya' : expiry}\n` +
                `⏳ Sisa Waktu: ${own ? '∞' : remaining + ' hari'}\n` +
                `📢 Jumlah grup yang pernah diinvite: ${userGroups.length}\n\n` +
                `💡 <i>Catatan: Masukkan bot ke 1 grup tambahan untuk menambah 3 hari durasi akses.</i>`
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /sharemsg ====================
        if (text === '/sharemsg') {
            if (!(await checkChannel(userId))) return sendMsg(chatId, '⚠️ Mohon selesaikan verifikasi Join Channel dengan ketik /start');
            if (!hasAccess(db, userId)) {
                return sendMsg(chatId,
                    `⏰ <b>Akses Kamu Telah Habis!</b>\n\n` +
                    `Kamu tidak memiliki izin VIP untuk melakukan share pesan.\n` +
                    `Silakan tambahkan bot ke minimal <b>1 grup Telegram</b> sebagai admin atau member untuk kembali mendapatkan akses selama <b>3 hari</b>.`
                );
            }
            if (!msg.reply_to_message) return sendMsg(chatId, '⚠️ Cara pakai yang benar: <b>Reply / Balas</b> pesan yang ingin kamu sebar, lalu ketik command /sharemsg');

            const keyboard = {
                inline_keyboard: [
                    [{ text: '📤 Kirim (Mode Copy)', callback_data: `share_copy_${chatId}_${msg.reply_to_message.message_id}_${userId}` }]
                ]
            };

            if (isOwner(userId)) {
                keyboard.inline_keyboard.push([
                    { text: '📎 Kirim (Mode Forward - Tag Channel)', callback_data: `share_forward_${chatId}_${msg.reply_to_message.message_id}_${userId}` }
                ]);
            }

            await sendMsg(chatId, '📤 <b>Silakan Pilih Mode Pengiriman:</b>\n\n<i>Mode Copy</i> = Akan terlihat seolah-olah akun bot sendiri yang memposting.\n<i>Mode Forward</i> = Akan menampilkan header "Forwarded dari..." (Khusus Owner).', keyboard);
            return res.status(200).json({ status: 'OK' });
        }

        // ==============================================================
        // PERBAIKAN BUG LAG: BROADCAST OWNER BERJALAN DI BACKGROUND
        // ==============================================================
        if (text === '/broadcast') {
            if (!isOwner(userId)) return sendMsg(chatId, '❌ Perintah ditolak! Ini adalah zona khusus Developer/Owner.');
            if (!msg.reply_to_message) return sendMsg(chatId, '⚠️ Reply pesan yang mau di-broadcast!');

            const users = db.users || [];
            if (!users.length) return sendMsg(chatId, '❌ Database user masih kosong!');

            const replyId = msg.reply_to_message.message_id;
            const statusMsg = await sendMsg(chatId, '📡 Memulai Inisialisasi Broadcast Background...');

            // 1. RESPON KE TELEGRAM AGAR TIDAK MACET
            res.status(200).json({ status: 'OK' });

            // 2. JALANKAN PROSES LAMA DI BELAKANG LAYAR
            (async () => {
                let ok = 0, fail = 0;
                for (let i = 0; i < users.length; i++) {
                    (await copyMsg(users[i], chatId, replyId)) ? ok++ : fail++;
                    
                    if ((i + 1) % 10 === 0 || i === users.length - 1) {
                        try {
                            await fetch(`${TELEGRAM_API}/editMessageText`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: chatId,
                                    message_id: statusMsg?.result?.message_id,
                                    text: `📡 <b>Proses Broadcast PM</b>\n\nTarget: ${users.length} Users\n✅ Sukses: ${ok} | ❌ Gagal (Blokir Bot): ${fail}\n\n⏳ Progres: ${i + 1}/${users.length}`,
                                    parse_mode: 'HTML'
                                })
                            });
                        } catch (error) {}
                    }
                    await new Promise(r => setTimeout(r, 100));
                }

                db.stats.totalShares += ok;
                await saveDB(db);
                await sendMsg(chatId, `🎉 <b>Broadcast PM Selesai!</b>\nBerhasil dikirim ke ${ok} orang.`);
            })();

            return;
        }

        // ==================== /setpesan ====================
        if (text === '/setpesan') {
            if (!(await checkChannel(userId))) return sendMsg(chatId, '⚠️ Verifikasi Join Channel dulu di /start');
            if (!hasAccess(db, userId)) return sendMsg(chatId, '⏰ Akses expired! Tambahkan bot ke grup terlebih dahulu.');
            if (!msg.reply_to_message) return sendMsg(chatId, '⚠️ Reply pesan iklan/promosi kamu lalu ketik /setpesan untuk menyimpannya ke memori.');

            if (!db.autoMessages) db.autoMessages = {};
            db.autoMessages[String(userId)] = { chatId, messageId: msg.reply_to_message.message_id };
            await saveDB(db);
            await sendMsg(chatId, '✅ <b>Format Pesan Tersimpan!</b>\n\nFormat ini telah dikunci sebagai pesan utamamu. Selanjutnya, ketik <code>/auto on</code> untuk menghidupkan penyebaran otomatis tanpa henti.');
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /auto ====================
        if (text.startsWith('/auto')) {
            if (!(await checkChannel(userId))) return sendMsg(chatId, '⚠️ Verifikasi Join Channel dulu di /start');
            if (!hasAccess(db, userId)) return sendMsg(chatId, '⏰ Akses expired! Tambahkan bot ke grup terlebih dahulu.');

            const arg = text.replace('/auto', '').trim().toLowerCase();
            const saved = db.autoMessages?.[String(userId)];

            if (arg === 'on') {
                if (!saved) return sendMsg(chatId, '⚠️ Kamu belum mengatur materi pesan. Gunakan <code>/setpesan</code> (dengan me-reply iklannya) terlebih dahulu!');
                autoShares[String(userId)] = {
                    active: true,
                    chatId: saved.chatId,
                    messageId: saved.messageId,
                    lastSent: 0,
                    round: 0
                };
                await sendMsg(chatId, '✅ Sistem Auto Share: <b>🟢 AKTIF</b>\n\nBot Jasher kini bekerja di belakang layar. Iklan kamu akan terus disebarkan secara bergilir tanpa kamu harus menekan tombol apapun.\n<i>(Ketik /auto off jika ingin menghentikannya)</i>');
            } else if (arg === 'off') {
                delete autoShares[String(userId)];
                await sendMsg(chatId, '❌ Sistem Auto Share: <b>🔴 DIHENTIKAN</b>\nDistribusi massal telah dimatikan.');
            } else {
                const active = autoShares[String(userId)]?.active;
                await sendMsg(chatId, `📊 Status Engine Auto Share kamu saat ini: <b>${active ? '🟢 BERJALAN' : '🔴 MATI'}</b>\n\nKetik "/auto on" atau "/auto off" untuk merubah.`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== /owner ====================
        if (text === '/owner') {
            if (!isOwner(userId)) return sendMsg(chatId, '❌ Command tidak dikenali atau Anda tidak punya wewenang.');

            const displayUsers = db.users.length + FAKE_USERS;
            const displayGroups = (db.groups || []).length + FAKE_GROUPS;

            await sendMsg(chatId,
                `👑 <b>CONTROL PANEL - COMMAND CENTER</b>\n\n` +
                `📊 <b>Data Global Sistem:</b>\n` +
                `├ Terlihat (Display): ${displayUsers} Users | ${displayGroups} Groups\n` +
                `├ Real/Asli (System): ${db.users.length} Users | ${(db.groups || []).length} Groups\n` +
                `└ Total Distribusi Share: ${db.stats?.totalShares || 0}\n\n` +
                `🔧 <b>Daftar Perintah Eksekutif:</b>\n` +
                `/broadcast — Siaran ke semua PM bot\n` +
                `/addowner [ID] — Angkat dev baru\n` +
                `/removeowner [ID] — Lengserkan dev\n` +
                `/blacklist [ID] — Banned user bandel\n` +
                `/unblacklist [ID] — Cabut banned\n` +
                `/addgroup [ID] — Paksa injeksi grup\n` +
                `/removegroup [ID] — Hapus grup\n` +
                `/listgroups — Lihat list ID grup\n` +
                `/giveaccess [ID] — Injeksi durasi VIP 3 hari\n` +
                `/revokeaccess [ID] — Musnahkan VIP user\n` +
                `/backup — Download JSON Database\n\n` +
                `👨‍💻 Sistem Dirancang Oleh: ${DEVELOPER}`
            );
            return res.status(200).json({ status: 'OK' });
        }

        // ==================== OWNER COMMANDS ====================
        if (text.startsWith('/addowner') && isOwner(userId)) {
            const id = text.replace('/addowner', '').trim();
            if (id && !OWNER_IDS.includes(id)) {
                OWNER_IDS.push(id);
                await sendMsg(chatId, `✅ ID ${id} sah menjadi jajaran Owner!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/removeowner') && isOwner(userId)) {
            const id = text.replace('/removeowner', '').trim();
            const idx = OWNER_IDS.indexOf(id);
            if (idx > 0) {
                OWNER_IDS.splice(idx, 1);
                await sendMsg(chatId, `✅ Akses Owner ID ${id} dicabut!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/blacklist') && isOwner(userId)) {
            const id = text.replace('/blacklist', '').trim();
            if (!db.blacklist) db.blacklist = [];
            if (id && !db.blacklist.includes(id)) {
                db.blacklist.push(id);
                await saveDB(db);
                await sendMsg(chatId, `🚫 User dengan ID ${id} ditendang ke dimensi Blacklist!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/unblacklist') && isOwner(userId)) {
            const id = text.replace('/unblacklist', '').trim();
            if (db.blacklist) {
                db.blacklist = db.blacklist.filter(x => x !== id);
                await saveDB(db);
                await sendMsg(chatId, `✅ User ${id} dibebaskan dari Blacklist!`);
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
                await sendMsg(chatId, `✅ Grup ${id} diinjeksi manual ke database!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/removegroup') && isOwner(userId)) {
            const id = text.replace('/removegroup', '').trim();
            if (db.groups) {
                db.groups = db.groups.filter(g => g !== id);
                db.stats.totalGroups = db.groups.length;
                await saveDB(db);
                await sendMsg(chatId, `✅ Grup ${id} dihapus dari jalur share!`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text === '/listgroups' && isOwner(userId)) {
            const groups = db.groups || [];
            const list = groups.slice(-30).map((g, i) => `${i + 1}. <code>${g}</code>`).join('\n');
            await sendMsg(chatId, `📋 <b>Log Top 30 Grup Aktif</b> (Total Real: ${groups.length})\n\n${list || 'Masih kosong melompong'}`);
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
                await sendMsg(chatId, `✅ Golden Ticket: Durasi VIP 3 Hari ditransfer ke user ${id}!\n📅 Aktif hingga: ${exp}`);
            }
            return res.status(200).json({ status: 'OK' });
        }

        if (text.startsWith('/revokeaccess') && isOwner(userId)) {
            const id = text.replace('/revokeaccess', '').trim();
            if (id && db.accessExpiry?.[id]) {
                delete db.accessExpiry[id];
                await saveDB(db);
                await sendMsg(chatId, `✅ Mode VIP milik user ${id} dimusnahkan!`);
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
                        caption: `📅 Backup Arsip Tanggal: ${new Date().toISOString()}\n👥 Jumlah Register: ${db.users.length} Users\n📢 Tautan Grup: ${(db.groups||[]).length} Endpoint\n\n*Jaga file ini baik-baik.`,
                        file_name: `JasherDatabase_Backup_${Date.now()}.json`
                    })
                });
            } catch (error) {
                await sendMsg(chatId, '❌ Gagal mengunggah dokumen Backup!');
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
                await new Promise(r => setTimeout(r, 400)); 
            }

            db.stats.totalShares += ok;
            await saveDB(db);

            try {
                await sendMsg(userId, `🔄 <b>Laporan Auto Share Loop #${config.round}</b>\n\n✅ Pengiriman Sukses: ${ok} grup\n❌ Pengiriman Gagal: ${groups.length - ok} grup`);
            } catch (error) {}
        }
    } catch (error) {
        console.error("AutoShare Loop Error:", error.message);
    }
}, 30000);
