require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

// Configuration
const API_TOKEN = '8591995558:AAH-_Fb-iCJ-ANeEiD8oqr0Qts3JlW8qStA';
//const API_TOKEN = '8382899337:AAHEOI6vK66CRfEUIggku5GE_GlbKCMQjEs';
const ADMIN_ID = '1278018722'; // Main Owner ID as String

// Initialize Bot
const bot = new TelegramBot(API_TOKEN, { polling: true });
console.log("Bot is starting...");

// Helper for replies
bot.onReplyToMessage = (chatId, messageId, callback) => {
    const handler = (msg) => {
        if (msg.chat.id === chatId && msg.reply_to_message && msg.reply_to_message.message_id === messageId) {
            bot.removeListener('message', handler);
            callback(msg);
        }
    };
    bot.on('message', handler);
};

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
    // Simple text without markdown to avoid errors with special characters in names
    const username = user.username ? `@${user.username}` : 'N/A';
    
    bot.sendMessage(msg.chat.id, `👤 Wallet Info\n\n🆔 ID: ${userId}\n🔗 User: ${username}\n💵 Balance: ${user.balance} MMK`);
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
        // Escape Markdown characters for Code and Package Name if needed
        // Or simpler: Use MarkdownV2 properly or just no parse mode for complex text
        // But for consistency let's just avoid markdown errors by not using parse_mode for list items or escaping
        // Safe approach: Use monospace for code only
        res += `━━━━━━━━━━━━━━\n📦 Pack: ${item.package_name}\n🎟 Code: \`${item.code}\`\n📅 နေ့စွဲ: ${date}\n`;
    });
    
    // Split message if too long or just catch error
    try {
        await bot.sendMessage(msg.chat.id, res, { parse_mode: 'Markdown' });
    } catch (e) {
        // Fallback without markdown if special chars cause error
        await bot.sendMessage(msg.chat.id, res.replace(/`/g, ''));
    }
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
        
        // Always try to send photo first if ID exists
        let sent = false;
        if (method.qr_photo_id && method.qr_photo_id.length > 5) {
            try {
                await bot.sendPhoto(chatId, method.qr_photo_id, { caption: payMsg, parse_mode: 'Markdown' });
                sent = true;
            } catch (e) {
                console.error("QR Send Failed (Invalid ID), sending text only.");
            }
        }
        
        if (!sent) {
            bot.sendMessage(chatId, payMsg, { parse_mode: 'Markdown' });
        }
        
        waitForScreenshot(chatId, amount);
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
    else if (data.startsWith('buy_gp_')) {
        const pid = data.split('_')[2];
        const pkg = await db.get_game_package_by_id(pid);
        
        if (!pkg) return bot.answerCallbackQuery(query.id, { text: "❌ Invalid Package" });
        
        const text = `❓ **Confirm Purchase**\n\n🎮 Game: **${pkg.game_name}**\n📦 Pack: **${pkg.name}**\n💵 Price: **${pkg.price} MMK**`;
        const inline_keyboard = [
            [{ text: "✅ Buy Now", callback_data: `confirm_gp_${pid}` }],
            [{ text: "❌ Cancel", callback_data: "cancel_order" }]
        ];
        
        bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data.startsWith('confirm_gp_')) {
        const pid = data.split('_')[2];
        const pkg = await db.get_game_package_by_id(pid);
        const userId = query.from.id;
        
        if (!pkg) return bot.answerCallbackQuery(query.id, { text: "❌ Invalid Package" });
        
        const user = await db.get_user(userId);
        if (user.balance < pkg.price) {
            return bot.answerCallbackQuery(query.id, { text: "❌ Insufficient Balance", show_alert: true });
        }
        
        // Try Auto Delivery (Stock)
        const code = await db.get_and_use_stock(String(pid));
        if (code) {
            await db.update_balance(userId, -pkg.price);
            await db.add_history(userId, `${pkg.game_name} - ${pkg.name}`, code);
            
            const successMsg = `✅ **Purchased!**\n\n🎮 ${pkg.game_name}\n📦 ${pkg.name}\n🎟 Code: \`${code}\`\n💰 Price: ${pkg.price} MMK`;
            bot.sendMessage(userId, successMsg, { parse_mode: 'Markdown' });
            bot.editMessageText("✅ **Success! Check PM.**", { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
            return;
        }
        
        // Manual Order Flow (If no stock)
        await db.update_balance(userId, -pkg.price);
        // Ask for ID
        bot.sendMessage(chatId, `🆔 **Enter Player ID / Details for ${pkg.game_name}:**`, { reply_markup: { force_reply: true } })
           .then(prompt => {
               bot.onReplyToMessage(chatId, prompt.message_id, async (reply) => {
                   const details = reply.text;
                   // Log as Pending
                   await db.add_history(userId, `${pkg.game_name} - ${pkg.name}`, "Pending (Manual)");
                   
                   bot.sendMessage(chatId, "✅ **Order Received!**\nAdmin will process it shortly.");
                   
                   // Notify Admin
                   const adminMsg = `🛒 **New Manual Order**\n👤 User: ${userId}\n🎮 Game: ${pkg.game_name}\n📦 Pack: ${pkg.name}\n📝 Details: \`${details}\`\n💰 Paid: ${pkg.price}`;
                   const adminMarkup = {
                       inline_keyboard: [
                           [{ text: "✅ Done", callback_data: `man_done_${userId}` }],
                           [{ text: "❌ Refund", callback_data: `man_ref_${userId}_${pkg.price}` }]
                       ]
                   };
                   
                   const admins = await db.get_all_admins();
                   const allAdmins = new Set([...admins, ADMIN_ID]);
                   allAdmins.forEach(aid => {
                       bot.sendMessage(aid, adminMsg, { reply_markup: adminMarkup, parse_mode: 'Markdown' });
                   });
               });
           });
           
        bot.deleteMessage(chatId, msgId); // Remove confirmation menu
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

// Admin Dashboard
bot.onText(/\/admin/, async (msg) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    const inline_keyboard = [
        [{ text: "📊 Check Stock", callback_data: "admin_check_stock" }],
        [{ text: "📦 Manage Packages", callback_data: "admin_manage_packages" }],
        [{ text: "🎮 Manage Games", callback_data: "admin_manage_games" }],
        [{ text: "➕ Add New Package", callback_data: "admin_add_package" }],
        [{ text: "💳 Manage Payments", callback_data: "admin_manage_payments" }],
        [{ text: "👥 Manage Users", callback_data: "admin_manage_users" }],
        [{ text: "❌ Close", callback_data: "admin_close" }]
    ];
    
    bot.sendMessage(msg.chat.id, "🔧 **Admin Dashboard**", { reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
});

bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    if (data === 'admin_close') {
        bot.deleteMessage(chatId, msgId);
    }
    else if (data === 'admin_check_stock') {
        const games = await db.get_games();
        const inline_keyboard = [
            [{ text: "🎮 PUBG UC (Legacy)", callback_data: "adm_chk_stk_legacy" }]
        ];
        games.forEach(g => {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `adm_chk_stk_g_${g.id}` }]);
        });
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        
        bot.editMessageText("📊 **Select Game to Check Stock:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data === 'adm_chk_stk_legacy') {
        const packages = await db.get_packages();
        let report = "📦 **PUBG UC (Legacy) Stock**\n\n";
        for (const k of Object.keys(packages)) {
            const cnt = await db.get_stock_count(k);
            report += `🔹 ${packages[k].name}: **${cnt}** Codes\n`;
        }
        const inline_keyboard = [[{ text: "🔙 Back", callback_data: "admin_check_stock" }]];
        bot.editMessageText(report, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data.startsWith('adm_chk_stk_g_')) {
        const gid = data.split('_')[4];
        const packages = await db.get_game_packages(gid);
        let report = `📦 **Game Stock**\n\n`;
        if (packages.length === 0) report += "No packages found.";
        else {
            for (const p of packages) {
                const cnt = await db.get_stock_count(String(p.id));
                report += `🔹 ${p.name}: **${cnt}** Codes\n`;
            }
        }
        const inline_keyboard = [[{ text: "🔙 Back", callback_data: "admin_check_stock" }]];
        bot.editMessageText(report, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data === 'admin_back_main') {
        const inline_keyboard = [
            [{ text: "📊 Check Stock", callback_data: "admin_check_stock" }],
            [{ text: "📦 Manage Packages", callback_data: "admin_manage_packages" }],
            [{ text: "🎮 Manage Games", callback_data: "admin_manage_games" }],
            [{ text: "➕ Add New Package", callback_data: "admin_add_package" }],
            [{ text: "💳 Manage Payments", callback_data: "admin_manage_payments" }],
            [{ text: "👥 Manage Users", callback_data: "admin_manage_users" }],
            [{ text: "❌ Close", callback_data: "admin_close" }]
        ];
        bot.editMessageText("🔧 **Admin Dashboard**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data === 'admin_manage_packages') {
        const packages = await db.get_packages();
        const inline_keyboard = [];
        Object.keys(packages).forEach(k => {
            const p = packages[k];
            inline_keyboard.push([{ text: `${p.name} (${p.price} MMK)`, callback_data: `adm_pkg_${k}` }]);
        });
        inline_keyboard.push([{ text: "➕ Add New Package", callback_data: "admin_add_package" }]);
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        
        bot.editMessageText("📦 **Select Package to Edit/Delete:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data.startsWith('adm_pkg_')) {
        const pk = data.split('_')[2];
        const packages = await db.get_packages();
        const pack = packages[pk];
        
        if (!pack) return bot.answerCallbackQuery(query.id, { text: "❌ Package Not Found" });
        
        const stockCount = await db.get_stock_count(pk);
        const inline_keyboard = [
            [{ text: "✏️ Edit Price", callback_data: `adm_edit_price_${pk}` }],
            [{ text: "➕ Add Stock", callback_data: `adm_add_stock_${pk}` }],
            [{ text: "🗑 Delete", callback_data: `adm_del_pkg_${pk}` }],
            [{ text: "🔙 Back", callback_data: "admin_manage_packages" }]
        ];
        
        const text = `📦 **Package Details**\n\n🆔 ID: ${pk}\n📛 Name: ${pack.name}\n💵 Price: ${pack.price} MMK\n📊 Stock: ${stockCount}`;
        
        try {
            await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
        } catch(e) {
            await bot.editMessageText(text.replace(/\*/g, ''), { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard } });
        }
    }
    
    else if (data === 'admin_add_package') {
        const promptMsg = await bot.sendMessage(chatId, "➕ **Enter New Package Identifier (e.g., 60, 325):**", { reply_markup: { force_reply: true } });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply1) => {
            const pid = reply1.text.trim();
            const prompt2 = await bot.sendMessage(chatId, `📛 **Enter Name for ${pid} (e.g., 60 UC):**`, { reply_markup: { force_reply: true } });
            
            bot.onReplyToMessage(chatId, prompt2.message_id, async (reply2) => {
                const name = reply2.text.trim();
                const prompt3 = await bot.sendMessage(chatId, `💵 **Enter Price for ${name}:**`, { reply_markup: { force_reply: true } });
                
                bot.onReplyToMessage(chatId, prompt3.message_id, async (reply3) => {
                    const price = parseInt(reply3.text.trim());
                    if (!isNaN(price)) {
                        try {
                            await db.query("INSERT INTO packages (identifier, name, price) VALUES ($1, $2, $3)", [pid, name, price]);
                            bot.sendMessage(chatId, `✅ **Package Added!**\n${name} - ${price} MMK`);
                        } catch (e) {
                            bot.sendMessage(chatId, "❌ Failed. Identifier might exist.");
                        }
                    } else {
                        bot.sendMessage(chatId, "❌ Invalid Price.");
                    }
                });
            });
        });
    }

    else if (data.startsWith('adm_edit_price_')) {
        const pk = data.split('_')[3];
        const promptMsg = await bot.sendMessage(chatId, `💵 **Enter New Price for Package ${pk}:**`, { reply_markup: { force_reply: true } });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const price = parseInt(reply.text.trim());
            if (!isNaN(price)) {
                await db.query("UPDATE packages SET price = $1 WHERE identifier = $2", [price, pk]);
                bot.sendMessage(chatId, `✅ **Price Updated!**`);
            } else {
                bot.sendMessage(chatId, "❌ Invalid Price.");
            }
        });
    }

    else if (data.startsWith('adm_del_pkg_')) {
        const pk = data.split('_')[3];
        await db.query("DELETE FROM packages WHERE identifier = $1", [pk]);
        bot.answerCallbackQuery(query.id, { text: "✅ Package Deleted" });
        bot.sendMessage(chatId, "✅ Package Deleted. Refresh menu.");
    }
    
    else if (data.startsWith('adm_add_stock_')) {
        const pk = data.split('_')[3];
        const promptMsg = await bot.sendMessage(chatId, `📦 **Enter Codes for Package ${pk}**\n(Separate by space or new line)`, { reply_markup: { force_reply: true } });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const codes = reply.text.trim().split(/\s+/);
            let count = 0;
            for (const code of codes) {
                if (await db.add_stock(pk, code)) count++;
            }
            bot.sendMessage(chatId, `✅ Added ${count} codes to Package ${pk}.`);
        });
    }

    else if (data === 'admin_manage_games') {
        const games = await db.get_games();
        const inline_keyboard = [];
        games.forEach(g => {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `adm_game_${g.id}` }]);
        });
        inline_keyboard.push([{ text: "➕ Add New Game", callback_data: "admin_add_game" }]);
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        
        bot.editMessageText("🎮 **Select Game to Manage:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data === 'admin_add_game') {
        const promptMsg = await bot.sendMessage(chatId, "🎮 **Enter New Game Name:**", {
            reply_markup: { force_reply: true }
        });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const name = reply.text;
            if (name) {
                try {
                    await db.query("INSERT INTO games (name) VALUES ($1)", [name]);
                    bot.sendMessage(chatId, `✅ **Game Added:** ${name}`);
                } catch (e) {
                    bot.sendMessage(chatId, "❌ Failed. Name might exist.");
                }
            }
        });
    }

    else if (data.startsWith('adm_game_')) {
        const gid = data.split('_')[2];
        const packages = await db.get_game_packages(gid);
        // Escape or use simple text for Game ID
        let report = `🎮 **Game ID:** ${gid}\n📦 **Packages:**\n`;
        
        const inline_keyboard = [
            [{ text: "➕ Add Package", callback_data: `adm_add_gp_${gid}` }],
            [{ text: "🗑 Delete Game", callback_data: `adm_del_game_${gid}` }],
            [{ text: "🔙 Back", callback_data: "admin_manage_games" }]
        ];

        if (packages.length > 0) {
            packages.forEach(p => {
                // Ensure no markdown break
                report += `- ${p.name} (${p.price} MMK)\n`;
            });
        } else {
            report += "(No packages yet)";
        }
        
        // Use try-catch for markdown errors
        try {
            await bot.editMessageText(report, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
        } catch (e) {
             await bot.editMessageText(report.replace(/\*/g, '').replace(/`/g, ''), { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard } });
        }
    }

    else if (data.startsWith('adm_add_gp_')) {
        const gid = data.split('_')[3];
        const promptMsg = await bot.sendMessage(chatId, "📦 **Enter Package Name & Price (e.g., '100 Diamonds - 5000'):**", {
            reply_markup: { force_reply: true }
        });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const text = reply.text;
            if (text.includes('-')) {
                const [name, priceStr] = text.split('-').map(s => s.trim());
                const price = parseInt(priceStr);
                if (name && price) {
                     await db.query("INSERT INTO game_packages (game_id, name, price) VALUES ($1, $2, $3)", [gid, name, price]);
                     bot.sendMessage(chatId, `✅ Package Added: ${name}`);
                } else {
                    bot.sendMessage(chatId, "❌ Invalid Format.");
                }
            } else {
                bot.sendMessage(chatId, "❌ Use format: Name - Price");
            }
        });
    }

    else if (data.startsWith('adm_del_game_')) {
        const gid = data.split('_')[3];
        await db.query("DELETE FROM games WHERE id = $1", [gid]);
        bot.answerCallbackQuery(query.id, { text: "✅ Game Deleted" });
        // Refresh list... ideally call admin_manage_games logic again or just send message
        bot.sendMessage(chatId, "✅ Game Deleted. Type /admin to refresh.");
    }
    
    // Manage Payments
    else if (data === 'admin_manage_payments') {
        const methods = await db.get_payment_methods();
        const inline_keyboard = [];
        methods.forEach(m => {
            inline_keyboard.push([{ text: `${m.name} - ${m.account_name}`, callback_data: `adm_pay_${m.id}` }]);
        });
        inline_keyboard.push([{ text: "➕ Add New Payment", callback_data: "admin_add_payment" }]);
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        
        bot.editMessageText("💳 **Manage Payment Methods:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data.startsWith('adm_pay_')) {
        const mid = data.split('_')[2];
        const methods = await db.get_payment_methods();
        const m = methods.find(x => x.id == mid);
        
        if (!m) return bot.answerCallbackQuery(query.id, { text: "❌ Method Not Found" });
        
        const inline_keyboard = [
            [{ text: "� Delete", callback_data: `adm_del_pay_${mid}` }],
            [{ text: "�� Back", callback_data: "admin_manage_payments" }]
        ];
        
        const text = `💳 **Payment Detail**\n\n📛 Name: ${m.name}\n🔢 Acc: \`${m.account_number}\`\n👤 Owner: ${m.account_name}`;
        bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }

    else if (data.startsWith('adm_del_pay_')) {
        const mid = data.split('_')[3];
        await db.query("DELETE FROM payment_methods WHERE id = $1", [mid]);
        bot.answerCallbackQuery(query.id, { text: "✅ Deleted" });
        bot.sendMessage(chatId, "✅ Payment Method Deleted.");
    }

    else if (data === 'admin_add_payment') {
        const promptMsg = await bot.sendMessage(chatId, "📛 **Enter Payment Name (e.g., KBZ Pay):**", { reply_markup: { force_reply: true } });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply1) => {
            const name = reply1.text;
            const prompt2 = await bot.sendMessage(chatId, `🔢 **Enter Account Number for ${name}:**`, { reply_markup: { force_reply: true } });
            
            bot.onReplyToMessage(chatId, prompt2.message_id, async (reply2) => {
                const acc = reply2.text;
                const prompt3 = await bot.sendMessage(chatId, `👤 **Enter Account Name for ${acc}:**`, { reply_markup: { force_reply: true } });
                
                bot.onReplyToMessage(chatId, prompt3.message_id, async (reply3) => {
                    const owner = reply3.text;
                    const prompt4 = await bot.sendMessage(chatId, "📸 **Send QR Code Photo (or type 'skip'):**", { reply_markup: { force_reply: true } });
                    
                    const handleQr = async (reply4) => {
                        let qrId = null;
                        if (reply4.photo) {
                            qrId = reply4.photo[reply4.photo.length - 1].file_id;
                        } else if (reply4.text && reply4.text.toLowerCase() !== 'skip') {
                            // User sent text but not 'skip', maybe mistake?
                            // Let's assume no QR if text is sent unless it's 'skip'
                            qrId = null;
                        }
                        
                        await db.query("INSERT INTO payment_methods (name, account_number, account_name, qr_photo_id) VALUES ($1, $2, $3, $4)", [name, acc, owner, qrId]);
                        bot.sendMessage(chatId, `✅ **Payment Method Added!**\n${name} - ${acc}`);
                    };
                    
                    bot.once('message', (msg) => {
                         if (msg.chat.id === chatId) handleQr(msg);
                    });
                });
            });
        });
    }

    // Manage Users
    else if (data === 'admin_manage_users') {
        const res = await db.query("SELECT COUNT(*) FROM users");
        const count = res.rows[0].count;
        
        // Fetch recent users (limit 10)
        const recentRes = await db.query("SELECT * FROM users ORDER BY joined_at DESC LIMIT 10");
        const users = recentRes.rows;
        
        const inline_keyboard = [];
        
        users.forEach(u => {
            const display = u.username ? `@${u.username}` : u.user_id;
            inline_keyboard.push([{ text: `👤 ${display} | 💰 ${u.balance}`, callback_data: `adm_user_dtl_${u.user_id}` }]);
        });
        
        inline_keyboard.push([{ text: "🔍 Find User", callback_data: "admin_find_user" }]);
        inline_keyboard.push([{ text: "➕ Add Balance", callback_data: "admin_add_bal_prompt" }]);
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        
        bot.editMessageText(`👥 **User Management**\n\n📊 Total Users: **${count}**\n👇 **Recent Users:**`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data.startsWith('adm_user_dtl_')) {
        const uid = data.split('_')[3];
        const user = await db.get_user(uid);
        
        if (user) {
            const inline_keyboard = [
                [{ text: "➕ Add Balance", callback_data: `adm_add_bal_${user.user_id}` }],
                [{ text: "➖ Deduct Balance", callback_data: `adm_sub_bal_${user.user_id}` }],
                [{ text: "🔙 Back", callback_data: "admin_manage_users" }]
            ];
            
            const username = user.username ? `@${user.username}` : 'N/A';
            
            // Safe formatting (No Markdown for dynamic fields)
            const text = `👤 **User Details**\n\n🆔 ID: ${user.user_id}\n🔗 User: ${username}\n💵 Balance: ${user.balance} MMK\n📅 Joined: ${new Date(user.joined_at).toLocaleDateString()}`;
            
            try {
                // Try Markdown first (only if you are sure special chars are handled, but safest is plain or simple HTML)
                // Actually, just sending it as Markdown might fail if username has underscores.
                // Let's use no parse_mode or minimal safe mode.
                // But wait, we need bold.
                // Safest fix: Escape the dynamic content.
                
                // OR simpler: Just don't use markdown for the dynamic parts in the edit.
                // But editMessageText requires consistency.
                
                // Let's strip special chars from username for display if using markdown
                const safeUsername = username.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
                const safeText = `👤 *User Details*\n\n🆔 ID: \`${user.user_id}\`\n🔗 User: ${safeUsername}\n💵 Balance: \`${user.balance} MMK\`\n📅 Joined: ${new Date(user.joined_at).toLocaleDateString()}`;
                
                await bot.editMessageText(safeText, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'MarkdownV2' });
            } catch (e) {
                // Fallback: Plain text
                const plainText = `👤 User Details\n\n🆔 ID: ${user.user_id}\n🔗 User: ${username}\n💵 Balance: ${user.balance} MMK\n📅 Joined: ${new Date(user.joined_at).toLocaleDateString()}`;
                await bot.editMessageText(plainText, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard } });
            }
        } else {
            bot.answerCallbackQuery(query.id, { text: "User not found" });
        }
    }

    else if (data === 'admin_find_user') {
        const promptMsg = await bot.sendMessage(chatId, "🔍 **Enter User ID or Username to Find:**", { reply_markup: { force_reply: true } });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const input = reply.text.trim().replace('@', '');
            let user = null;
            
            // Try ID first
            if (/^\d+$/.test(input)) {
                user = await db.get_user(input);
            } else {
                // Try Username
                const res = await db.query("SELECT * FROM users WHERE username = $1", [input]);
                if (res.rows.length > 0) user = res.rows[0];
            }
            
            if (user) {
                const inline_keyboard = [
                    [{ text: "➕ Add Balance", callback_data: `adm_add_bal_${user.user_id}` }],
                    [{ text: "➖ Deduct Balance", callback_data: `adm_sub_bal_${user.user_id}` }],
                    [{ text: "🔙 Back", callback_data: "admin_manage_users" }]
                ];
                
                const username = user.username ? `@${user.username}` : 'N/A';
                bot.sendMessage(chatId, `👤 **User Found**\n\n🆔 ID: \`${user.user_id}\`\n🔗 User: ${username}\n💵 Balance: \`${user.balance} MMK\`\n📅 Joined: ${new Date(user.joined_at).toLocaleDateString()}`, { reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "❌ User not found.");
            }
        });
    }

    else if (data === 'admin_add_bal_prompt') {
        const promptMsg = await bot.sendMessage(chatId, "👤 **Enter User ID to Add Balance:**", { reply_markup: { force_reply: true } });
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const uid = reply.text.trim();
            if (/^\d+$/.test(uid)) {
                // Trigger the balance flow
                const user = await db.get_user(uid);
                if (user) {
                     // Hacky: Reuse the callback handler logic? Better to just call it or copy logic.
                     // Let's prompt amount directly
                     const p2 = await bot.sendMessage(chatId, `💵 **Enter Amount to ADD for ${uid}:**`, { reply_markup: { force_reply: true } });
                     bot.onReplyToMessage(chatId, p2.message_id, async (r2) => {
                         const amt = parseInt(r2.text);
                         if (!isNaN(amt)) {
                             await db.update_balance(uid, amt);
                             bot.sendMessage(chatId, `✅ Added ${amt} MMK to User ${uid}.`);
                             bot.sendMessage(uid, `🎉 **Admin added ${amt} MMK to your wallet!**`, { parse_mode: 'Markdown' }).catch(()=>{});
                         }
                     });
                } else {
                    bot.sendMessage(chatId, "❌ User not found.");
                }
            } else {
                bot.sendMessage(chatId, "❌ Invalid ID.");
            }
        });
    }

    else if (data.startsWith('adm_add_bal_')) {
        const uid = data.split('_')[3];
        const promptMsg = await bot.sendMessage(chatId, `➕ **Enter Amount to ADD for User ${uid}:**`, { reply_markup: { force_reply: true } });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const amount = parseInt(reply.text);
            if (!isNaN(amount)) {
                await db.update_balance(uid, amount);
                const user = await db.get_user(uid);
                bot.sendMessage(chatId, `✅ **Success!**\n💰 Added: ${amount} MMK\n👤 User: ${uid}\n💵 New Balance: ${user.balance} MMK`);
                bot.sendMessage(uid, `🎉 **Admin added ${amount} MMK to your wallet!**\n💰 New Balance: ${user.balance} MMK`, { parse_mode: 'Markdown' }).catch(()=>{});
            } else {
                bot.sendMessage(chatId, "❌ Invalid Amount.");
            }
        });
    }

    else if (data.startsWith('adm_sub_bal_')) {
        const uid = data.split('_')[3];
        const promptMsg = await bot.sendMessage(chatId, `➖ **Enter Amount to DEDUCT for User ${uid}:**`, { reply_markup: { force_reply: true } });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const amount = parseInt(reply.text);
            if (!isNaN(amount)) {
                await db.update_balance(uid, -amount);
                const user = await db.get_user(uid);
                bot.sendMessage(chatId, `✅ **Success!**\n💰 Deducted: ${amount} MMK\n👤 User: ${uid}\n💵 New Balance: ${user.balance} MMK`);
                bot.sendMessage(uid, `⚠️ **Admin deducted ${amount} MMK from your wallet.**\n💰 New Balance: ${user.balance} MMK`, { parse_mode: 'Markdown' }).catch(()=>{});
            } else {
                bot.sendMessage(chatId, "❌ Invalid Amount.");
            }
        });
    }

}); // End of callback_query




bot.onText(/\/tell (.+)/, async (msg, match) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    const args = match[1].split(' ');
    const targetId = args[0];
    const text = args.slice(1).join(' ');
    
    if (!targetId || !text) return bot.sendMessage(msg.chat.id, "⚠️ Usage: `/tell [USER_ID] [Message]`");
    
    try {
        await bot.sendMessage(targetId, `🔔 **Admin Message:**\n${text}`, { parse_mode: 'Markdown' });
        bot.sendMessage(msg.chat.id, `✅ Sent to ${targetId}`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Failed: ${e.message}`);
    }
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    const text = match[1];
    const statusMsg = await bot.sendMessage(msg.chat.id, "⏳ Broadcasting...");
    
    // Get all users (Need to implement get_all_users in db.js or query directly)
    try {
        const res = await db.query("SELECT user_id FROM users");
        const users = res.rows;
        let count = 0;
        let blocked = 0;
        
        for (const u of users) {
            try {
                await bot.sendMessage(u.user_id, text, { parse_mode: 'Markdown' });
                count++;
                // Add small delay to avoid rate limits
                await new Promise(r => setTimeout(r, 30)); 
            } catch (e) {
                blocked++;
            }
        }
        
        bot.editMessageText(`✅ **Broadcast Complete!**\nSent: ${count}\nBlocked: ${blocked}`, { chat_id: msg.chat.id, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    }
});

console.log("Bot setup complete.");
