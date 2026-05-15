const fetch = require('node-fetch');

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ==================== MYSTERY ASSETS ====================
const K_LIST = [
    "Macan Terbang", "Kipas Angin Cosmos", "Jin Samsudin", "Knalpot Racing", 
    "Tuyul Muallaf", "Siluman Panci", "Lele Darat", "Nyamuk DBD", "Sepatu Bata Kiri",
    "Naga Bonar", "Megalodon Sumatra", "Kucing Oren Berpeci", "Sapu Lidi Sakti",
    "Gundoruwo Insomnia", "Dispenser Rusak"
];

const T_LIST = [
    "Yakin aja dulu walaupun ujung-ujungnya nyesel 🗿", "Mimpi!", 
    "Tanya aja sama tembok.", "Gas ngeng! Jangan kasih kendor 🔥", 
    "Jangan ngarep, mending turu.", "Bisa jadi, tapi boong.", 
    "Coba tanya lagi besok kalau gue lagi mood.", "Peluangnya 99% GAGAL.",
    "Bintang-bintang berkata: IYA.", "Mending lu makan gorengan dulu biar tenang."
];

const D_LIST = [
    "Sering makan gorengan 3 ngakunya 1", "Suka nge-ghosting anak orang",
    "Sering ketiduran pas lagi di-chat panjang lebar", "Lupa bayar utang dari tahun lalu",
    "Suka nyalip dari kiri pas lampu merah", "Suka pinjem korek tapi ga pernah dibalikin",
    "Diam-diam suka ngabisin kuota temen", "Sering nyanyi di kamar mandi fales banget"
];

// ==================== HELPERS ====================
async function sendMsg(chatId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await fetch(`${TELEGRAM_API}/sendMessage`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
    } catch (e) {}
}

function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

async function sendAction(chatId, action) {
    try {
        await fetch(`${TELEGRAM_API}/sendChatAction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, action: action })
        });
    } catch (e) {}
}

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
    // Balas Vercel instan agar tidak timeout
    if (req.method !== 'POST') return res.status(200).send('Mystery Box Active 📦');
    res.status(200).json({ status: 'OK' });

    const body = req.body;

    if (body.message) {
        const msg = body.message;
        const text = msg.text || '';
        const chatId = msg.chat.id;
        const username = msg.from.first_name || 'Manusia';

        if (text === '/start') {
            await sendAction(chatId, 'typing');
            await new Promise(r => setTimeout(r, 500));
            await sendMsg(chatId,
                `📦 <b>WELCOME TO THE MYSTERY BOX</b> 📦\n\n` +
                `Halo, ${username}. Kamu telah membangunkan saya dari tidur panjang di server Vercel.\n\n` +
                `Pilih salah satu takdirmu hari ini:\n` +
                `🔮 <code>/cekkhodam [namamu]</code>\n` +
                `🎱 <code>/tebak [pertanyaanmu]</code>\n` +
                `⚖️ <code>/dosaku</code>\n` +
                `💻 <code>/hekel</code>\n\n` +
                `Atau... jangan klik apa-apa dan tinggalkan tempat ini.`
            );
        }
        else if (text.startsWith('/cekkhodam')) {
            const name = text.replace('/cekkhodam', '').trim() || username;
            const khodam = getRandom(K_LIST);
            const power = Math.floor(Math.random() * 100000);
            
            await sendAction(chatId, 'typing');
            await sendMsg(chatId, 
                `🔍 <b>HASIL SCAN SPIRITUAL</b>\n\n` +
                `👤 Nama: <b>${name}</b>\n` +
                `👻 Khodam: <b>${khodam}</b>\n` +
                `⚡ Power Level: ${power}\n\n` +
                `<i>Saran: Kasih makan khodamnya kemenyan rasa matcha biar ga ngambek.</i>`
            );
        }
        else if (text.startsWith('/tebak')) {
            const question = text.replace('/tebak', '').trim();
            if (!question) {
                await sendMsg(chatId, '❓ Mau nebak apaan kalau pertanyaannya kosong, bos? Format: <code>/tebak [pertanyaan]</code>');
                return;
            }
            await sendAction(chatId, 'choose_sticker');
            await sendMsg(chatId, 
                `🗣️ <b>PERTANYAAN:</b> ${question}\n` +
                `👁️ <b>JAWABAN:</b> ${getRandom(T_LIST)}`
            );
        }
        else if (text === '/dosaku') {
            const percent = Math.floor(Math.random() * 100);
            await sendAction(chatId, 'typing');
            await sendMsg(chatId, 
                `⚖️ <b>ANALISIS DOSA HARI INI</b>\n\n` +
                `Tingkat Kegelapan: ${percent}%\n` +
                `Penyebab Utama: <b>${getRandom(D_LIST)}</b>\n\n` +
                `<i>Tobat bang...</i> 🗿`
            );
        }
        else if (text === '/hekel') {
            const statusMsg = await fetch(`${TELEGRAM_API}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: 'Mengekstrak IP Address...' })
            }).then(r => r.json());

            if (statusMsg.ok) {
                const msgId = statusMsg.result.message_id;
                const steps = [
                    "Bypass Firewall...",
                    "Mencuri riwayat browser...",
                    "Menemukan folder 'Tugas Sekolah'...",
                    "Menganalisis isi folder (Isinya mencurigakan)...",
                    "✅ <b>HACKING SELESAI!</b>\n\nMenyebarkan riwayat browser Anda ke grup keluarga dalam 3... 2... 1... 🚀"
                ];

                for (let i = 0; i < steps.length; i++) {
                    await new Promise(r => setTimeout(r, 800));
                    await fetch(`${TELEGRAM_API}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            message_id: msgId,
                            text: steps[i],
                            parse_mode: 'HTML'
                        })
                    });
                }
            }
        }
        else {
            if (!text.startsWith('/')) {
                await sendMsg(chatId, '🤫 Ssst... Jangan banyak bicara. Cukup ketik perintah yang ada di <code>/start</code>.');
            }
        }
    }
};
