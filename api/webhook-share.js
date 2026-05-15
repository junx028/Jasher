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

// Fake Stats
const FAKE_USERS = 560;
const FAKE_GROUPS = 247;

// ==================== DATABASE ====================
async function getDB() {
    try {
        const res = await fetch(GIST_API, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }});
        if (!res.ok) return initDB();
        const gist = await res.json();
        return JSON.parse(gist.files['database.json'].content);
    } catch (e) { return initDB(); }
}

async function saveDB(db) {
    try {
        await fetch(GIST_API, {
            method: 'PATCH',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: { 'database.json': { content: JSON.stringify(db, null, 0) } } }) // null,0 agar size DB super kecil (minify)
        });
    } catch (e) {}
}

function initDB() {
    return { users: [], groups: [], blacklist: [], userGroups: {}, accessExpiry: {}, autoMessages: {}, stats: { totalShares: 0 } };
}

// ==================== HELPERS ====================
async function sendMsg(chatId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await fetch(`${TELEGRAM_API}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) {}
}

async function checkChannel(userId) {
    try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: CHANNEL_USERNAME, user_id: userId }) });
        const data = await res.json();
        if (!data.ok) return true; 
        return ['member', 'administrator', 'creator'].includes(data.result?.status);
    } catch (e) { return true; }
}

function isOwner(userId) { return OWNER_IDS.includes(String(userId)); }
function hasAccess(db, userId) {
    if (isOwner(userId)) return true;
    return (db.accessExpiry?.[String(userId)] || 0) > Date.now();
}

// 🚀 SISTEM BATCH NGEBUT KHUSUS VERCEL
async function fastBroadcast(targets, fromChatId, messageId, mode = 'copy') {
    let ok = 0, fail = 0;
    const chunkSize = 20; // Kirim rombongan 20 pesan sekaligus
    
    for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const promises = chunk.map(async (id) => {
            try {
                const endpoint = mode === 'copy' ? '/copyMessage' : '/forwardMessage';
                const res = await fetch(`${TELEGRAM_API}${endpoint}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: id, from_chat_id: fromChatId, message_id: messageId })
                });
                const data = await res.json();
                data.ok ? ok++ : fail++;
            } catch (e) { fail++; }
        });
        
        await Promise.all(promises);
        if (i + chunkSize < targets.length) await new Promise(r => setTimeout(r, 1000)); // Jeda 1 detik biar gak kena spam limit Telegram
    }
    return { ok, fail };
}

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('Vercel Bot Active');
    const body = req.body;
    
    // Kirim respons instan 200 OK ke Telegram agar tidak Timeout
    res.status(200).json({ status: 'OK' });

    const db = await getDB();

    // 1. DETEKSI GRUP (RINGAN)
    if (body.my_chat_member) {
        const myMember = body.my_chat_member;
        const chatId = myMember.chat.id;
        const newStatus = myMember.new_chat_member.status;
        const adderId = myMember.from.id;
        
        if (['member', 'administrator'].includes(newStatus)) {
            if (!db.groups) db.groups = [];
            if (!db.groups.includes(String(chatId))) {
                db.groups.push(String(chatId));
                
                if (!db.userGroups) db.userGroups = {};
                if (!db.userGroups[String(adderId)]) db.userGroups[String(adderId)] = [];
                if (!db.userGroups[String(adderId)].includes(String(chatId))) db.userGroups[String(adderId)].push(String(chatId));

                const threeDays = 3 * 24 * 60 * 60 * 1000;
                db.accessExpiry[String(adderId)] = Math.max((db.accessExpiry?.[String(adderId)] || Date.now()), Date.now()) + threeDays;
                
                await saveDB(db);
                const expDate = new Date(db.accessExpiry[String(adderId)]).toLocaleString('id-ID');
                await sendMsg(chatId, `✅ <b>Bot Siap!</b>\nSpesial untuk pengundang, VIP 3 Hari aktif sd: ${expDate}\nKetik /start di PM.`);
                await sendMsg(adderId, `🎉 <b>Akses VIP 3 Hari Aktif!</b>\nBot ditambahkan ke grup.\nGunakan /sharemsg untuk mulai.`);
            }
        } else if (['left', 'kicked'].includes(newStatus)) {
            if (db.groups && db.groups.includes(String(chatId))) {
                db.groups = db.groups.filter(g => g !== String(chatId));
                await saveDB(db);
            }
        }
        return;
    }

    // 2. CALLBACK BUTTON (FAST SHARE)
    if (body.callback_query) {
        const q = body.callback_query;
        const data = q.data;
        const chatId = q.message.chat.id;
        const userId = q.from.id;

        if (data === 'check_join') {
            if (await checkChannel(userId)) await sendMsg(chatId, '✅ Berhasil! Ketik /start');
            else await sendMsg(chatId, '❌ Belum terdeteksi join!', { inline_keyboard: [[{ text: '📢 Join', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }]] });
            return;
        }

        if (data.startsWith('share_')) {
            const parts = data.split('_');
            const mode = parts[1]; // copy / forward
            const fromChatId = parts[2];
            const replyMsgId = parts[3];
            const ownerId = parts[4];
            
            if (String(userId) !== ownerId) return;
            if (!hasAccess(db, userId)) return sendMsg(chatId, '⏰ <b>Akses habis!</b> Tambahkan bot ke 1 grup baru untuk akses 3 hari.');
            
            const groups = db.groups || [];
            if (!groups.length) return sendMsg(chatId, '❌ Database grup kosong!');

            await sendMsg(chatId, '⚡ Memulai pengiriman super cepat (Vercel Batch Mode)...');
            const result = await fastBroadcast(groups, fromChatId, parseInt(replyMsgId), mode);
            
            db.stats.totalShares += result.ok;
            await saveDB(db);
            await sendMsg(chatId, `🎉 <b>Selesai!</b>\n✅ Sukses: ${result.ok}\n❌ Gagal: ${result.fail}\n\n*Jika gagal banyak, artinya bot tidak admin di grup tsb.`);
            return;
        }
    }

    // 3. PESAN & COMMAND
    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username || msg.from.first_name;
        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

        if (isGroup) return; // Skip proses command di grup biar server ringan

        // Register User
        if (!db.users) db.users = [];
        if (!db.users.includes(String(userId))) { db.users.push(String(userId)); await saveDB(db); }
        if ((db.blacklist || []).includes(String(userId))) return;

        if (text === '/start') {
            if (!(await checkChannel(userId))) return sendMsg(chatId, `⚠️ <b>Akses Ditolak</b>\nJoin dulu: <b>${CHANNEL_USERNAME}</b>`, { inline_keyboard: [[{ text: '📢 Join', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }], [{ text: '🔄 Cek', callback_data: 'check_join' }]] });
            
            const own = isOwner(userId);
            const access = hasAccess(db, userId);
            const statusText = own ? '👑 Owner' : (access ? '✅ VIP Aktif' : '❌ Nonaktif');
            
            await sendMsg(chatId,
                `🤖 <b>JASHER BOT VERCEL</b>\n\n` +
                `Halo ${username}!\n` +
                `🔹 /sharemsg - Share manual ke semua grup\n` +
                `🔹 /status - Cek masa aktif\n` +
                `🔹 /help - Bantuan\n\n` +
                `📊 <b>Data Global:</b>\n` +
                `├ Users: ${db.users.length + FAKE_USERS}\n` +
                `├ Groups: ${(db.groups || []).length + FAKE_GROUPS}\n` +
                `└ Statusmu: ${statusText}\n\n` +
                `*Mode Auto-Share dimatikan permanen karena Vercel Serverless.`
            );
        }
        else if (text === '/sharemsg') {
            if (!hasAccess(db, userId)) return sendMsg(chatId, '⏰ Tambahkan bot ke grup baru untuk akses VIP 3 Hari!');
            if (!msg.reply_to_message) return sendMsg(chatId, '⚠️ Reply pesan yang mau disebar lalu ketik /sharemsg');
            
            const btn = [[{ text: '📤 Kirim (Copy)', callback_data: `share_copy_${chatId}_${msg.reply_to_message.message_id}_${userId}` }]];
            if (isOwner(userId)) btn.push([{ text: '📎 Kirim (Forward)', callback_data: `share_forward_${chatId}_${msg.reply_to_message.message_id}_${userId}` }]);
            
            await sendMsg(chatId, '📤 Pilih mode pengiriman:', { inline_keyboard: btn });
        }
        else if (text === '/broadcast' && isOwner(userId)) {
            if (!msg.reply_to_message) return sendMsg(chatId, '⚠️ Reply pesannya bos!');
            await sendMsg(chatId, '⚡ Memulai Broadcast PM...');
            const result = await fastBroadcast(db.users || [], chatId, msg.reply_to_message.message_id, 'copy');
            await sendMsg(chatId, `🎉 Broadcast PM Selesai\n✅ Sukses: ${result.ok} | ❌ Gagal: ${result.fail}`);
        }
        else if (text === '/owner' && isOwner(userId)) {
            await sendMsg(chatId, `👑 <b>OWNER PANEL</b>\n/broadcast (reply pesan)\n/addgroup [id]\n/giveaccess [id]\n/backup`);
        }
        // Dan lain-lain (Command berat dihilangkan agar hemat Vercel limits)
    }
};
