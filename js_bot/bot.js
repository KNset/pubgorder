require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

// Configuration
//const API_TOKEN = '8591995558:AAH-_Fb-iCJ-ANeEiD8oqr0Qts3JlW8qStA';
const API_TOKEN = '8382899337:AAHEOI6vK66CRfEUIggku5GE_GlbKCMQjEs';
const ADMIN_ID = '1278018722'; // Main Owner ID as String

// Initialize Bot
const bot = new TelegramBot(API_TOKEN, { polling: true });
console.log("Bot is starting...");

// Initialize DB
db.init_db().then(() => console.log("DB Ready"));

// Helpers
async function isAdmin(userId) {
    if (String(userId) === ADMIN_ID) return true;
    return await db.is_admin(userId);
}

// Menus
const MAIN_MENU = {
    reply_markup: {
        keyboard: [
            ['🛒 Games', '💰 Add Funds'],
            ['👤 Wallet', '📜 History']
        ],
        resize_keyboard: true
    }
};

// Start Command
bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    const username = msg.from.username;
    
    try {
        const user = await db.get_user(userId, username);
        const balance = user ? user.balance : 0;
        
        bot.sendMessage(msg.chat.id, `🎮 **JOE GAME SHOP မှ ကြိုဆိုပါတယ်!**\n💵 သင့်လက်ကျန်ငွေ: \`${balance} MMK\``, {
            parse_mode: 'Markdown',
            ...MAIN_MENU
        });
    } catch (e) {
        console.error(e);
    }
});

// Wallet
bot.onText(/👤 Wallet/, async (msg) => {
    const userId = msg.from.id;
    const user = await db.get_user(userId, msg.from.username);
    const username = user.username ? `@${user.username}` : 'N/A';
    
    bot.sendMessage(msg.chat.id, `👤 **သင့် Wallet အချက်အလက်**\n🆔 ID: \`${userId}\`\n🔗 User: ${username}\n💵 လက်ကျန်ငွေ: \`${user.balance} MMK\``, { parse_mode: 'Markdown' });
});

// History
bot.onText(/📜 History/, async (msg) => {
    const userId = msg.from.id;
    const history = await db.get_history(userId);
    
    if (history.length === 0) {
        return bot.sendMessage(msg.chat.id, "📜 ဝယ်ယူမှုမှတ်တမ်း မရှိသေးပါဘူးဗျ။");
    }
    
    let res = "📜 **နောက်ဆုံးဝယ်ယူမှု မှတ်တမ်းများ**\n";
    history.forEach(item => {
        const date = new Date(item.purchase_date).toLocaleString();
        res += `━━━━━━━━━━━━━━\n📦 Pack: ${item.package_name}\n🎟 Code: \`${item.code}\`\n📅 နေ့စွဲ: ${date}\n`;
    });
    
    bot.sendMessage(msg.chat.id, res, { parse_mode: 'Markdown' });
});

// Add Funds
bot.onText(/💰 Add Funds/, async (msg) => {
    bot.sendMessage(msg.chat.id, "💰 **ငွေဖြည့်မည့် ပမာဏကို ရိုက်ထည့်ပါ -**")
        .then(sent => {
            bot.once('message', (reply) => processDeposit(reply));
        });
});

async function processDeposit(msg) {
    if (msg.text === '💰 Add Funds' || msg.text === '🛒 Games') return; // Cancel if user clicks menu
    if (!/^\d+$/.test(msg.text)) {
        return bot.sendMessage(msg.chat.id, "❌ ဂဏန်းသီးသန့်သာ ရိုက်ပေးပါဗျ။");
    }
    
    const amount = msg.text;
    const methods = await db.get_payment_methods();
    
    if (methods.length === 0) {
        return bot.sendMessage(msg.chat.id, "❌ Payment methods not available.");
    }
    
    const inline_keyboard = methods.map(m => ([{
        text: m.name,
        callback_data: `pay_${m.id}_${amount}`
    }]));
    
    bot.sendMessage(msg.chat.id, "💳 **ငွေပေးချေမည့် နည်းလမ်းကို ရွေးချယ်ပါ -**", {
        reply_markup: { inline_keyboard },
        parse_mode: 'Markdown'
    });
}

// Payment Callback
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    
    if (data.startsWith('pay_')) {
        const [_, mid, amount] = data.split('_');
        const methods = await db.get_payment_methods();
        const method = methods.find(m => m.id == mid);
        
        if (!method) return bot.answerCallbackQuery(callbackQuery.id, { text: "❌ Invalid Method" });
        
        const payMsg = `💳 ပမာဏ: **${amount} MMK**\n\n🏧 **${method.name}**\n━━━━━━━━━━━━━━\n• **Account**: \`${method.account_number}\`\n• **Name**: **${method.account_name}**\n━━━━━━━━━━━━━━\n\n📸 **Guide:** ငွေလွှဲပြီးပါက Screenshot (ပြေစာ) ပို့ပေးပါဗျ။`;
        
        if (method.qr_photo_id) {
            bot.sendPhoto(chatId, method.qr_photo_id, { caption: payMsg, parse_mode: 'Markdown' })
                .then(() => waitForScreenshot(chatId, amount));
        } else {
            bot.sendMessage(chatId, payMsg, { parse_mode: 'Markdown' })
                .then(() => waitForScreenshot(chatId, amount));
        }
    }
});

function waitForScreenshot(chatId, amount) {
    const handler = (msg) => {
        if (msg.chat.id !== chatId) return;
        bot.removeListener('photo', handler);
        
        if (!msg.photo) return bot.sendMessage(chatId, "❌ Screenshot ပြေစာ ပို့ပေးရန် လိုအပ်ပါတယ်။");
        
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const user = msg.from;
        const username = user.username ? `@${user.username}` : "No Username";
        
        const caption = `💰 Deposit Request\n👤 User: ${user.first_name}\n🔗 Username: ${username}\n🆔 ID: ${user.id}\n💵 Amount: ${amount} MMK`;
        
        const markup = {
            inline_keyboard: [[
                { text: "✅ Approve", callback_data: `adm_ok_${amount}_${user.id}` },
                { text: "❌ Reject", callback_data: `adm_no_${amount}_${user.id}` }
            ]]
        };
        
        // Notify Admins
        db.get_all_admins().then(admins => {
            const allAdmins = new Set([...admins, ADMIN_ID]);
            allAdmins.forEach(aid => {
                bot.sendPhoto(aid, photoId, { caption, reply_markup: markup }).catch(() => {});
            });
        });
        
        bot.sendMessage(chatId, "✅ Admin အတည်ပြုချက်အတွက် ပို့လိုက်ပါပြီ။");
    };
    bot.once('photo', handler);
}

// Admin Approval
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('adm_ok_') || data.startsWith('adm_no_')) {
        const [_, action, amt, uid] = data.split('_');
        const amount = parseInt(amt);
        const userId = uid; // String
        
        if (action === 'ok') {
            await db.get_user(userId); // Ensure user exists
            await db.update_balance(userId, amount);
            const user = await db.get_user(userId);
            
            bot.sendMessage(userId, `✅ **ငွေဖြည့်သွင်းမှု အောင်မြင်သည်!**\n💰 လက်ကျန်: \`${user.balance} MMK\``, { parse_mode: 'Markdown' }).catch(() => {});
            bot.editMessageCaption("🟢 Approved", { chat_id: query.message.chat.id, message_id: query.message.message_id });
        } else {
            bot.sendMessage(userId, `❌ **ငွေဖြည့်သွင်းမှု ငြင်းပယ်ခံရပါသည်!**\n💰 Amount: \`${amount} MMK\``, { parse_mode: 'Markdown' }).catch(() => {});
            bot.editMessageCaption("🔴 Rejected", { chat_id: query.message.chat.id, message_id: query.message.message_id });
        }
    }
});

// Games Menu
bot.onText(/🛒 Games/, async (msg) => {
    const games = await db.get_games();
    const inline_keyboard = [
        [{ text: "🎮 PUBG UC (Auto)", callback_data: "game_pubg" }]
    ];
    
    games.forEach(g => {
        if (g.name !== 'PUBG UC') {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `game_id_${g.id}` }]);
        }
    });
    
    bot.sendMessage(msg.chat.id, "🛒 **Select Game:**", { reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
});

// Game Selection Handler
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    
    if (data === 'game_pubg') {
        const packages = await db.get_packages();
        const inline_keyboard = [];
        
        Object.keys(packages).forEach(k => {
            const p = packages[k];
            inline_keyboard.push([{ text: `🎮 ${p.name} - ${p.price} MMK`, callback_data: `pre_${k}` }]);
        });
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "back_to_games" }]);
        
        bot.editMessageText("👇 **PUBG UC Packages:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data.startsWith('game_id_')) {
        const gid = data.split('_')[2];
        const packages = await db.get_game_packages(gid);
        const inline_keyboard = [];
        
        if (packages.length === 0) {
            inline_keyboard.push([{ text: "🔙 Back", callback_data: "back_to_games" }]);
            return bot.editMessageText("❌ No packages available.", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard } });
        }
        
        packages.forEach(p => {
            inline_keyboard.push([{ text: `📦 ${p.name} - ${p.price} MMK`, callback_data: `buy_gp_${p.id}` }]);
        });
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "back_to_games" }]);
        
        bot.editMessageText("👇 **Select Package:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data === 'back_to_games') {
        // Re-show game list (copy from Games handler)
        const games = await db.get_games();
        const inline_keyboard = [
            [{ text: "🎮 PUBG UC (Auto)", callback_data: "game_pubg" }]
        ];
        games.forEach(g => {
            if (g.name !== 'PUBG UC') {
                inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `game_id_${g.id}` }]);
            }
        });
        bot.editMessageText("🛒 **Select Game:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
});

// Pre-Purchase (Legacy)
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('pre_')) {
        const pk = data.split('_')[1];
        const packages = await db.get_packages();
        const pack = packages[pk];
        
        if (!pack) return bot.answerCallbackQuery(query.id, { text: "❌ Invalid Package" });
        
        const text = `❓ **ဝယ်ယူမှုကို အတည်ပြုပါ**\n\n📦 Pack: **${pack.name}**\n💵 ကျသင့်ငွေ: **${pack.price} MMK**\n\nတကယ်ဝယ်ယူမှာ သေချာပါသလား?`;
        const inline_keyboard = [
            [{ text: "✅ Confirm Purchase", callback_data: `buy_${pk}` }],
            [{ text: "❌ Cancel", callback_data: "cancel_order" }]
        ];
        
        bot.editMessageText(text, { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data === 'cancel_order') {
        bot.editMessageText("❌ ဝယ်ယူမှုကို ဖျက်သိမ်းလိုက်ပါပြီ။", { chat_id: query.message.chat.id, message_id: query.message.message_id });
    }
});

// Execute Purchase (Legacy)
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('buy_')) {
        const pk = data.split('_')[1];
        const userId = query.from.id;
        const packages = await db.get_packages();
        const pack = packages[pk];
        
        if (!pack) return bot.answerCallbackQuery(query.id, { text: "❌ Invalid Package" });
        
        const user = await db.get_user(userId);
        if (user.balance < pack.price) {
            return bot.answerCallbackQuery(query.id, { text: "❌ လက်ကျန်ငွေ မလုံလောက်ပါ။", show_alert: true });
        }
        
        const code = await db.get_and_use_stock(pk);
        if (!code) {
            return bot.answerCallbackQuery(query.id, { text: "⚠️ Stock ပြတ်နေပါသည်။", show_alert: true });
        }
        
        await db.update_balance(userId, -pack.price);
        await db.add_history(userId, pack.name, code);
        
        const successMsg = `✅ **Thank You for Purchasing!**\n\n📦 Package: **${pack.name}**\n🎟 Redeem Code: \`${code}\`\n\n💰 Price: \`${pack.price} MMK\`\n\n⚠️ Code can be used once.`;
        
        bot.sendMessage(userId, successMsg, { parse_mode: 'Markdown' });
        bot.editMessageText("✅ **Purchased Successfully!**\nCheck your Private Messages for the code.", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown' });
        
        // Notify Admins
        const admins = await db.get_all_admins();
        const allAdmins = new Set([...admins, ADMIN_ID]);
        allAdmins.forEach(aid => {
            bot.sendMessage(aid, `🛒 **New Sale!**\n👤 User: ${query.from.username}\n📦 Pack: ${pack.name}\n🎟 Code: \`${code}\``).catch(() => {});
        });
    }
});

// Admin Commands
bot.onText(/\/add (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    if (!(await isAdmin(userId))) return;
    
    const args = match[1].split(' ');
    const packId = args[0];
    const codes = args.slice(1);
    
    if (codes.length === 0) return bot.sendMessage(msg.chat.id, "⚠️ Usage: `/add [Pack_ID] [Code1] ...`");
    
    let count = 0;
    for (const code of codes) {
        if (await db.add_stock(packId, code)) count++;
    }
    
    bot.sendMessage(msg.chat.id, `✅ Added ${count} codes to Package ${packId}.`);
});

bot.onText(/\/checkstock/, async (msg) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    const packages = await db.get_packages();
    let report = "📦 **Stock Report**\n";
    
    for (const k of Object.keys(packages)) {
        const cnt = await db.get_stock_count(k);
        report += `🔹 ${packages[k].name}: **${cnt}**\n`;
    }
    
    bot.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
});

console.log("Bot setup complete.");
