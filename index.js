const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// --- تابع هوشمند پیدا کردن کروم (حل مشکل نسخه) ---
function findChromeExecutable() {
    // مسیر پیش‌فرض کش در Render
    const cacheRoot = '/opt/render/.cache/puppeteer/chrome';
    
    try {
        if (fs.existsSync(cacheRoot)) {
            // لیست نسخه‌های موجود
            const versions = fs.readdirSync(cacheRoot);
            if (versions.length > 0) {
                // پیدا کردن آخرین نسخه
                const latestVersion = versions[versions.length - 1];
                // ساخت مسیر کامل فایل اجرایی
                const execPath = path.join(cacheRoot, latestVersion, 'chrome-linux64', 'chrome');
                
                if (fs.existsSync(execPath)) {
                    console.log(`✅ مرورگر کروم پیدا شد در: ${execPath}`);
                    return execPath;
                }
            }
        }
    } catch (err) {
        console.error('خطا در جستجوی کروم:', err.message);
    }
    return null;
}

// --- تنظیمات ---
const CONFIG = {
    initialMessage: `🤖 🤖✨ سلام! من ربات چندمنظوره AI LAB هستم`,
    warningMessage: `⚠️ تذکر اول! ارسال لینک ممنوع است. بار بعدی اخراج هستید.`,
    welcomeMessage: `👋 به چند نفر جدید خوش آمدید! لطفاً قوانین را رعایت کنید.`,
    kickAfter: 2,
    welcomeTriggerCount: 5
};

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-gpu',
            '--no-zygote',
            '--single-process', 
            '--disable-dev-shm-usage'
        ],
        // استفاده از تابع پیدا کردن خودکار
        executablePath: findChromeExecutable()
    }
});

// اگر مرورگر پیدا نشد، برنامه اصلاً اجرا نشود تا ارورهای عجیب ندهد
if (!findChromeExecutable()) {
    console.error('❌ خطای بحرانی: مرورگر کروم نصب نشده یا پیدا نشد.');
    console.error('لطفا مطمئن شوید در package.json دستور postinstall وجود دارد.');
    process.exit(1);
}

const userOffenses = {};
const pendingJoins = [];

client.on('qr', (qr) => {
    console.log('----------------------------------');
    console.log('QR Code تولید شد (اسکن کنید):');
    qrcode.generate(qr, {small: true});
    console.log('----------------------------------');
});

client.on('ready', async () => {
    console.log('✅ بات متصل شد!');
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        console.log(`در حال ارسال پیام به ${groups.length} گروه...`);
        for (const group of groups) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1000)); 
                await group.sendMessage(CONFIG.initialMessage);
            } catch (err) {}
        }
        console.log('✅ پیام ارسال شد.');
    } catch (error) {
        console.error('خطا:', error);
    }
});

client.on('group_join', async (notification) => {
    if (!notification) return;
    let newParticipants = notification.participantIds || notification.recipients;
    if (!newParticipants || !Array.isArray(newParticipants)) return;
    newParticipants.forEach(id => pendingJoins.push(id));
    console.log(`${newParticipants.length} نفر جوین شدند. (مجموع: ${pendingJoins.length})`);
    if (pendingJoins.length >= CONFIG.welcomeTriggerCount) {
        try {
            const chat = await notification.getChat();
            let mentions = pendingJoins.map(id => `@${id.split('@')[0]}`).join(' ');
            const finalMessage = `${CONFIG.welcomeMessage}\n\n${mentions}`;
            await chat.sendMessage(finalMessage);
            console.log('✅ پیام خوش‌آمدگویی ارسال شد.');
            pendingJoins.length = 0; 
        } catch (err) { console.error('خطا در خوش‌آمدگویی:', err.message); }
    }
});

client.on('message_create', async (msg) => {
    if (msg.fromMe) return;
    if (!msg.author) return; 
    const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(bit\.ly\/[^\s]+)/;
    if (!linkRegex.test(msg.body)) return;

    try {
        const chat = await msg.getChat();
        const isGroupAdmin = chat.participants.find(p => p.id._serialized === msg.author && p.isAdmin);
        if (isGroupAdmin) return; 

        if (!userOffenses[msg.author]) userOffenses[msg.author] = 0;
        userOffenses[msg.author]++;
        const offenseCount = userOffenses[msg.author];
        console.log(`[WARN] لینک توسط کاربر (تعداد خطا: ${offenseCount})`);

        await msg.delete(true);

        if (offenseCount >= CONFIG.kickAfter) {
            await chat.removeParticipants([msg.author]);
            console.log(`[KICK] کاربر اخراج شد.`);
        } else {
            await msg.reply(CONFIG.warningMessage);
        }
    } catch (err) {
        console.error('[ERROR] خطا:', err.message);
    }
});

client.on('disconnected', (reason) => {
    console.log('⚠️ اتصال قطع شد. ریستارت...', reason);
    process.exit(1);
});
client.on('auth_failure', (msg) => {
    console.error('❌ خطا:', msg);
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    console.error('❌ خطا:', err);
    process.exit(1);
});

client.initialize();
