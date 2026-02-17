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

// --- Admin Management Commands ---
bot.onText(/\/addadmin (.+)/, async (msg, match) => {
    if (String(msg.from.id) !== ADMIN_ID) return; // Only Main Owner
    const targetId = match[1].trim();
    if (await db.add_admin(targetId)) {
        bot.sendMessage(msg.chat.id, `✅ User ${targetId} is now an Admin!`);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ User is already an Admin or Error.");
    }
});

bot.onText(/\/deladmin (.+)/, async (msg, match) => {
    if (String(msg.from.id) !== ADMIN_ID) return;
    const targetId = match[1].trim();
    if (await db.remove_admin(targetId)) {
        bot.sendMessage(msg.chat.id, `✅ User ${targetId} removed from Admins.`);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ User not found or Error.");
    }
});

bot.onText(/\/admins/, async (msg) => {
    if (String(msg.from.id) !== ADMIN_ID) return;
    const admins = await db.get_all_admins();
    let text = `👑 **Main Owner:** \`${ADMIN_ID}\`\n\n👮 **Admins:**\n`;
    admins.forEach(a => text += `- \`${a}\`\n`);
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// --- Midasbuy Cookies (Advanced) ---
bot.onText(/\/setcookies/, async (msg) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    // Check for file upload suggestion
    if (msg.text.length > 3000) {
        return bot.sendMessage(msg.chat.id, "⚠️ Text too long. Please upload as `.json` file.");
    }

    const jsonStr = msg.text.replace('/setcookies', '').trim();
    if (!jsonStr) return bot.sendMessage(msg.chat.id, "⚠️ Paste cookie JSON or upload file.");

    try {
        let cookies;
        // Simple heuristic parsing
        let cleaned = jsonStr.replace(/[\u201C\u201D\u2018\u2019]/g, '"'); // Fix smart quotes
        
        // Try to parse
        try {
            cookies = JSON.parse(cleaned);
        } catch (e) {
            // Try wrapping in [] if it looks like a list of objects but missing brackets
            if (cleaned.includes('},{') && !cleaned.startsWith('[')) {
                cookies = JSON.parse(`[${cleaned}]`);
            } else {
                throw e;
            }
        }

        if (!Array.isArray(cookies)) {
             // Handle single object
             if (typeof cookies === 'object' && cookies !== null) {
                 cookies = [cookies];
             } else {
                 throw new Error("Not a JSON array or object");
             }
        }
        
        await db.set_api_config('midasbuy', { cookies });
        bot.sendMessage(msg.chat.id, `✅ Cookies updated! (${cookies.length} count)`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error parsing JSON: ${e.message}`);
    }
});

bot.on('document', async (msg) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    if (msg.document.file_name.endsWith('.json') || (msg.caption && msg.caption.includes('/setcookies'))) {
        try {
            const fileLink = await bot.getFileLink(msg.document.file_id);
            const response = await fetch(fileLink);
            const content = await response.text();
            
            const cookies = JSON.parse(content);
            if (Array.isArray(cookies)) {
                await db.set_api_config('midasbuy', { cookies });
                bot.sendMessage(msg.chat.id, `✅ Cookies loaded from file! (${cookies.length} count)`);
            } else {
                bot.sendMessage(msg.chat.id, "❌ File must contain a JSON array.");
            }
        } catch (e) {
            bot.sendMessage(msg.chat.id, `❌ File Error: ${e.message}`);
        }
    }
});

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
        const userId = uid;
        
        if (isNaN(amount)) return bot.answerCallbackQuery(query.id, { text: "❌ Invalid Amount" });
        
        if (action === 'ok') {
            const userBefore = await db.get_user(userId); // Ensure user exists & get current
            if (!userBefore) return bot.answerCallbackQuery(query.id, { text: "❌ User not found" });
            
            const success = await db.update_balance(userId, amount);
            
            if (success) {
                const userAfter = await db.get_user(userId); // Fetch fresh
                
                bot.sendMessage(userId, `✅ **Deposit Approved!**\n➕ Added: \`${amount} MMK\`\n💰 Total Balance: \`${userAfter.balance} MMK\``, { parse_mode: 'Markdown' }).catch(() => {});
                
                // Update Admin Message
                bot.editMessageCaption(`🟢 **Approved**\n👤 User: ${userId}\n💰 Added: ${amount}\n💰 Balance: ${userBefore.balance} ➡️ ${userAfter.balance}`, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown' });
            } else {
                bot.answerCallbackQuery(query.id, { text: "❌ Update Failed (DB Error)" });
            }
        } else {
            bot.sendMessage(userId, `❌ **Deposit Rejected**\n💰 Amount: \`${amount} MMK\``, { parse_mode: 'Markdown' }).catch(() => {});
            bot.editMessageCaption(`🔴 **Rejected**\n👤 User: ${userId}\n💰 Amount: ${amount}`, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown' });
        }
    }
});

// Games Menu
bot.onText(/🛒 Games/, async (msg) => {
    const games = await db.get_games();
    const inline_keyboard = [];
    
    games.forEach(g => {
        // Only show games from the new 'games' table
        if (g.name !== 'PUBG UC') {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `game_id_${g.id}` }]);
        }
    });
    
    if (inline_keyboard.length === 0) {
        bot.sendMessage(msg.chat.id, "🛒 **No games available.**", { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, "🛒 **Select Game:**", { reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
});

// Game Selection Handler
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    
    if (data.startsWith('game_id_')) {
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
        
        if (!pkg) return bot.answerCallbackQuery(query.id, { text: "❌ Invalid Package ID" });
        
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
        
        if (!pkg) return bot.answerCallbackQuery(query.id, { text: "❌ Invalid Package" });
        
        const userId = query.from.id;
        const user = await db.get_user(userId);
        
        // Ensure numbers
        const balance = Number(user.balance);
        const price = Number(pkg.price);
        
        if (balance < price) {
            return bot.answerCallbackQuery(query.id, { text: `❌ Insufficient Balance\nYour Balance: ${balance}\nPrice: ${price}`, show_alert: true });
        }
        
        const balBefore = balance;
        
        // Try Auto Delivery (Stock)
        // Use pid as string
        const code = await db.get_and_use_stock(String(pid));
        if (code) {
            await db.update_balance(userId, -price);
            const balAfter = balBefore - price;
            
            await db.add_history(userId, `${pkg.game_name} - ${pkg.name}`, code);
            
            const successMsg = `✅ **Purchased!**\n\n🎮 ${pkg.game_name}\n📦 ${pkg.name}\n🎟 Code: \`${code}\`\n💰 Price: ${pkg.price} MMK`;
            bot.sendMessage(userId, successMsg, { parse_mode: 'Markdown' });
            bot.editMessageText("✅ **Success! Check PM.**", { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
            
            // Notify Admins (Auto Sale)
            const adminMsg = `🛒 **New Sale (Auto)**\n👤 User:@ ${query.from.username || userId}\n📦 Pack: ${pkg.game_name} - ${pkg.name}\n🎟 Code: \`${code}\`\n\n💰 Before: ${balBefore}\n💰 After: ${balAfter}`;
            const admins = await db.get_all_admins();
            const allAdmins = new Set([...admins, ADMIN_ID]);
            allAdmins.forEach(aid => {
                bot.sendMessage(aid, adminMsg, { parse_mode: 'Markdown' }).catch(() => {});
            });
            return;
        }
        
        // Check Game Type - If Token Game and No Stock, Error
        if (pkg.game_type === 'token') {
            return bot.answerCallbackQuery(query.id, { text: "⚠️ Stock ပြတ်နေပါသည် admin ကိုဆက်သွယ်ပါ။ @joe347664", show_alert: true });
        }
        
        // Manual Order Flow (For Normal Games)
        await db.update_balance(userId, -price);
        const balAfter = balBefore - price;
        
        // Ask for ID
        bot.sendMessage(chatId, `🆔 **Enter Player ID / Details for ${pkg.game_name}:**`, { reply_markup: { force_reply: true } })
           .then(prompt => {
               bot.onReplyToMessage(chatId, prompt.message_id, async (reply) => {
                   const details = reply.text;
                   // Log as Pending
                   await db.add_history(userId, `${pkg.game_name} - ${pkg.name}`, "Pending (Manual)");
                   
                   bot.sendMessage(chatId, "✅ **Order Received!**\nAdmin will process it shortly.");
                   
                   // Notify Admin
                   const adminMsg = `🛒 **New Manual Order**\n👤 User: @${username}\n🎮 Game: ${pkg.game_name}\n📦 Pack: ${pkg.name}\n📝 Details: \`${details}\`\n💰 Paid: ${pkg.price}\n\n💰 Before: ${balBefore}\n💰 After: ${balAfter}`;
                   const adminMarkup = {
                       inline_keyboard: [
                           [{ text: "✅ Done", callback_data: `man_done_${userId}` }],
                           [{ text: "❌ Refund", callback_data: `man_ref_${userId}_${price}` }]
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
        const games = await db.get_games();
        const inline_keyboard = [];
        games.forEach(g => {
            if (g.name !== 'PUBG UC') {
                inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `game_id_${g.id}` }]);
            }
        });
        
        if (inline_keyboard.length === 0) {
            bot.editMessageText("🛒 **No games available.**", { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
        } else {
            bot.editMessageText("🛒 **Select Game:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
        }
    }
    
    else if (data === 'cancel_order') {
        bot.editMessageText("❌ **Purchase Cancelled.**", { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
    }
});

// Admin Manual Order Actions
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    if (data.startsWith('man_done_')) {
        const uid = data.split('_')[2];
        try {
            await bot.sendMessage(uid, "✅ **Your Order has been Completed!**\nThank you for shopping.", { parse_mode: 'Markdown' });
        } catch (e) { console.log("User blocked bot or error sending msg"); }
        
        try {
            // Check if message has a caption (e.g. photo), otherwise edit text
            // The admin notification for manual order IS a text message, not a photo.
            // So editMessageCaption will fail. We should use editMessageText.
            // Wait, previous code used sendMessage for adminMsg, so it's text.
            await bot.editMessageText("✅ **Order Completed**", { chat_id: chatId, message_id: msgId });
        } catch (e) {
            console.error("Edit Done Msg Error:", e.message);
            // If it WAS a photo/caption (unlikely here but possible if I changed it), try caption
             try { await bot.editMessageCaption("✅ **Order Completed**", { chat_id: chatId, message_id: msgId }); } catch(e2){}
        }
    }
    
    else if (data.startsWith('man_ref_')) {
        const parts = data.split('_');
        const uid = parts[2];
        const amount = parseInt(parts[3]);
        
        if (!isNaN(amount)) {
            await db.update_balance(uid, amount);
            try {
                await bot.sendMessage(uid, `❌ **Order Cancelled & Refunded.**\n💰 Refunded: ${amount} MMK`, { parse_mode: 'Markdown' });
            } catch (e) {}
            
            try {
                await bot.editMessageText("🔴 **Order Refunded**", { chat_id: chatId, message_id: msgId });
            } catch (e) {
                 try { await bot.editMessageCaption("🔴 **Order Refunded**", { chat_id: chatId, message_id: msgId }); } catch(e2){}
            }
        }
    }
});

// Admin Commands
bot.onText(/\/checkstock/, async (msg) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    let report = "📦 **Stock Report**\n\n";
    
    // Legacy
    const packages = await db.get_packages();
    if (Object.keys(packages).length > 0) {
        report += "**PUBG UC (Legacy):**\n";
        for (const k of Object.keys(packages)) {
            const cnt = await db.get_stock_count(k);
            report += `🔹 ${packages[k].name}: **${cnt}**\n`;
        }
        report += "\n";
    }
    
    // New Games
    const games = await db.get_games();
    for (const g of games) {
        const gps = await db.get_game_packages(g.id);
        if (gps.length > 0) {
            report += `**${g.name}:**\n`;
            for (const p of gps) {
                const cnt = await db.get_stock_count(String(p.id));
                report += `🔹 ${p.name}: **${cnt}**\n`;
            }
            report += "\n";
        }
    }
    
    bot.sendMessage(msg.chat.id, report || "No stock found.", { parse_mode: 'Markdown' });
});

bot.onText(/\/add ([\s\S]+)/, async (msg, match) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    // Split by spaces, but respect lines if pasted
    const input = match[1];
    const args = input.trim().split(/\s+/);
    
    if (args.length < 2) return bot.sendMessage(msg.chat.id, "⚠️ Usage: `/add [Pack_ID] [Code1] [Code2] ...`\nExample: `/add 60 CODE1 CODE2` or `/add 5 CODE1`");
    
    const packId = args[0];
    const codes = args.slice(1);
    
    // Verify Package Exists (Legacy OR New)
    let packName = null;
    
    // Check Legacy
    const legacyPkgs = await db.get_packages();
    if (legacyPkgs[packId]) {
        packName = legacyPkgs[packId].name;
    } else {
        // Check New Game Package
        const newPkg = await db.get_game_package_by_id(packId);
        if (newPkg) {
            packName = `${newPkg.game_name} - ${newPkg.name}`;
        }
    }
    
    if (!packName) {
        return bot.sendMessage(msg.chat.id, `❌ Package ID \`${packId}\` not found.\nUse \`/admin\` -> 'Manage Games' or 'Manage Packages' to find IDs.`);
    }
    
    let count = 0;
    let duplicates = 0;
    const failedCodes = [];
    
    for (const code of codes) {
        if (await db.add_stock(packId, code)) {
            count++;
        } else {
            duplicates++;
            if (failedCodes.length < 5) failedCodes.push(code);
        }
    }
    
    let outputMsg = `📦 **Stock Added**\n📂 Package: **${packName}**\n✅ Added: ${count}\n⚠️ Duplicates/Failed: ${duplicates}`;
    if (failedCodes.length > 0) {
        outputMsg += `\n\n**Examples of Failed Codes:**\n` + failedCodes.map(c => `\`${c}\``).join('\n');
    }
    
    bot.sendMessage(msg.chat.id, outputMsg, { parse_mode: 'Markdown' });
});

// Admin Dashboard
bot.onText(/\/admin/, async (msg) => {
    if (!(await isAdmin(msg.from.id))) return;
    
    const inline_keyboard = [
        [{ text: "📊 Check Stock", callback_data: "admin_check_stock" }],
        [{ text: "🎮 Manage Games", callback_data: "admin_manage_games" }],
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
        const inline_keyboard = [];
        games.forEach(g => {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `adm_chk_stk_g_${g.id}` }]);
        });
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        
        bot.editMessageText("📊 **Select Game to Check Stock:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    else if (data === 'adm_chk_stk_legacy') {
        // Deprecated
        bot.answerCallbackQuery(query.id, { text: "Legacy system removed." });
    }
    
    else if (data.startsWith('adm_chk_stk_g_')) {
        const gid = data.split('_')[4];
        const packages = await db.get_game_packages(gid);
        const inline_keyboard = [];
        
        if (packages.length === 0) {
            bot.answerCallbackQuery(query.id, { text: "No packages found." });
        } else {
            for (const p of packages) {
                const cnt = await db.get_stock_count(String(p.id));
                inline_keyboard.push([
                    { text: `🔹 ${p.name}: ${cnt}`, callback_data: `adm_view_codes_${p.id}` },
                    { text: "🗑 Clear", callback_data: `adm_clear_stk_${p.id}` },
                    { text: "❌ Del Pkg", callback_data: `adm_del_pkg_stk_${p.id}` }
                ]);
            }
        }
        
        inline_keyboard.push([{ text: "🗑 Delete This Game", callback_data: `adm_del_game_stk_${gid}` }]);
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_check_stock" }]);
        bot.editMessageText(`📦 **Game Stock**\nClick package to view codes, 🗑 to clear stock, or ❌ to delete package:`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data.startsWith('adm_del_pkg_stk_')) {
        const pid = data.split('_')[4];
        // Confirm
        const inline_keyboard = [
            [{ text: "✅ Yes, Delete Package", callback_data: `adm_conf_del_pkg_${pid}` }],
            [{ text: "❌ Cancel", callback_data: "admin_check_stock" }]
        ];
        bot.editMessageText(`⚠️ **Delete Package?**\n\nThis will delete the package and ALL its stock.\nPackage ID: ${pid}\nAre you sure?`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data.startsWith('adm_conf_del_pkg_')) {
        const pid = data.split('_')[4];
        // Get game id before deleting to redirect back?
        // db.delete_game_package fetches it internally but doesn't return it easily.
        // We can just redirect to main check stock.
        
        if (await db.delete_game_package(pid)) {
             bot.answerCallbackQuery(query.id, { text: "✅ Package Deleted" });
             bot.sendMessage(chatId, `✅ Package ${pid} deleted.`);
        } else {
             bot.answerCallbackQuery(query.id, { text: "❌ Failed" });
        }
        
        // Go back
        const games = await db.get_games();
        const inline_keyboard = [];
        games.forEach(g => {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `adm_chk_stk_g_${g.id}` }]);
        });
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        bot.editMessageText("📊 **Select Game to Check Stock:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }

    else if (data.startsWith('adm_del_game_stk_')) {
        const gid = data.split('_')[4];
        // Confirm deletion
        const inline_keyboard = [
            [{ text: "✅ Yes, Delete Game", callback_data: `adm_conf_del_gm_${gid}` }],
            [{ text: "❌ Cancel", callback_data: `adm_chk_stk_g_${gid}` }]
        ];
        bot.editMessageText(`⚠️ **Delete Game?**\n\nThis will delete the game and ALL its packages/stock.\nAre you sure?`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data.startsWith('adm_conf_del_gm_')) {
        const gid = data.split('_')[4];
        // Use helper to ensure cache is cleared
        await db.delete_game(gid);
        bot.answerCallbackQuery(query.id, { text: "✅ Game Deleted" });
        
        // Go back to main stock list
        const games = await db.get_games();
        const inline_keyboard = [];
        games.forEach(g => {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `adm_chk_stk_g_${g.id}` }]);
        });
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        
        bot.editMessageText("📊 **Select Game to Check Stock:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }

    else if (data.startsWith('adm_clear_stk_')) {
        const pid = data.split('_')[3];
        // Confirm
        const inline_keyboard = [
            [{ text: "✅ Yes, Clear All", callback_data: `adm_confirm_clear_${pid}` }],
            [{ text: "❌ Cancel", callback_data: "admin_check_stock" }]
        ];
        bot.editMessageText(`⚠️ **Are you sure?**\n\nThis will delete ALL redeem codes for this package ID: ${pid}.\nThis action cannot be undone.`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }

    else if (data.startsWith('adm_confirm_clear_')) {
        const pid = data.split('_')[3];
        await db.clear_stock(pid);
        bot.answerCallbackQuery(query.id, { text: "✅ Stock Cleared" });
        bot.sendMessage(chatId, `✅ All stock for Package ${pid} has been cleared.`);
        // Go back to stock list? Need game id... simplified just go back to main stock menu
        // Or just let user click back.
        // Let's redirect to check stock main.
        const games = await db.get_games();
        const inline_keyboard = [];
        games.forEach(g => {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `adm_chk_stk_g_${g.id}` }]);
        });
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        bot.editMessageText("📊 **Select Game to Check Stock:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data.startsWith('adm_view_codes_')) {
        const pid = data.split('_')[3];
        const codes = await db.get_stock_codes(pid);
        
        // Check if legacy or new to get name
        let name = pid;
        const legacyPkgs = await db.get_packages();
        if (legacyPkgs[pid]) name = legacyPkgs[pid].name;
        else {
            const newPkg = await db.get_game_package_by_id(pid);
            if (newPkg) name = newPkg.name;
        }
        
        if (codes.length === 0) {
            bot.answerCallbackQuery(query.id, { text: `No codes for ${name}`, show_alert: true });
        } else {
            // Send as a new message because it might be long
            let msg = `📦 **Codes for ${name}** (${codes.length}):\n\n`;
            codes.forEach(c => msg += `\`${c}\`\n`);
            
            // Split if too long (Telegram limit 4096)
            if (msg.length > 4000) {
                const chunks = msg.match(/.{1,4000}/g);
                for (const chunk of chunks) {
                    await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
                }
            } else {
                await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            }
        }
    }

    else if (data === 'admin_back_main') {
        const inline_keyboard = [
            [{ text: "📊 Check Stock", callback_data: "admin_check_stock" }],
            [{ text: "🎮 Manage Games", callback_data: "admin_manage_games" }],
            [{ text: "💳 Manage Payments", callback_data: "admin_manage_payments" }],
            [{ text: "👥 Manage Users", callback_data: "admin_manage_users" }],
            [{ text: "❌ Close", callback_data: "admin_close" }]
        ];
        bot.editMessageText("🔧 **Admin Dashboard**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }

    else if (data === 'admin_manage_games') {
        // Force refresh cache to show newly added game
        const games = await db.query("SELECT * FROM games WHERE is_active = TRUE ORDER BY id ASC").then(res => res.rows);
        const inline_keyboard = [];
        games.forEach(g => {
            inline_keyboard.push([{ text: `🎮 ${g.name}`, callback_data: `adm_game_${g.id}` }]);
        });
        inline_keyboard.push([{ text: "➕ Add New Token Game", callback_data: "admin_add_token_game" }]);
        inline_keyboard.push([{ text: "➕ Add Normal Game", callback_data: "admin_add_normal_game" }]);
        inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
        
        bot.editMessageText("🎮 **Select Game to Manage:**", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
    }
    
    else if (data === 'admin_add_token_game') {
        const promptMsg = await bot.sendMessage(chatId, "🎮 **Enter New Token Game Name (e.g., PUBG, Free Fire):**", {
            reply_markup: { force_reply: true }
        });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const name = reply.text;
            if (name) {
                if (await db.add_game(name, 'token')) {
                    bot.sendMessage(chatId, `✅ **Token Game Added:** ${name}\nNow go to 'Manage Games' -> Select '${name}' -> 'Add Package' to set up redeem codes.`);
                } else {
                    bot.sendMessage(chatId, "❌ Failed. Name might exist.");
                }
            }
        });
    }

    else if (data === 'admin_add_normal_game') {
        const promptMsg = await bot.sendMessage(chatId, "🎮 **Enter New Normal Game Name:**", {
            reply_markup: { force_reply: true }
        });
        
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const name = reply.text;
            if (name) {
                if (await db.add_game(name, 'normal')) {
                    bot.sendMessage(chatId, `✅ **Normal Game Added:** ${name}\nNow add packages for it.`);
                } else {
                    bot.sendMessage(chatId, "❌ Failed. Name might exist.");
                }
            }
        });
    }

    else if (data.startsWith('adm_game_')) {
        const gid = data.split('_')[2];
        const packages = await db.get_game_packages(gid);
        
        // Get Game Type
        const games = await db.get_games();
        const game = games.find(g => g.id == gid);
        const isToken = game ? (game.game_type === 'token') : true; // Default to token if unknown
        
        let report = `🎮 **Game:** ${game ? game.name : gid}\n`;
        if (isToken) {
            report += `📦 **Packages & IDs:**\n(Use these IDs for /add command)\n\n`;
        } else {
            report += `📦 **Packages:**\n\n`;
        }
        
        const inline_keyboard = [
            [{ text: "➕ Add Package", callback_data: `adm_add_gp_${gid}` }],
            [{ text: "🗑 Delete Game", callback_data: `adm_del_game_${gid}` }],
            [{ text: "🔙 Back", callback_data: "admin_manage_games" }]
        ];

        if (packages.length > 0) {
            packages.forEach(p => {
                if (isToken) {
                    report += `- **${p.name}**\n   🆔 ID: \`${p.id}\` | 💵 ${p.price} MMK\n`;
                } else {
                    report += `- **${p.name}** | 💵 ${p.price} MMK\n`;
                }
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
                     // Use the helper to add package (handles cache clearing)
                     await db.add_game_package(gid, name, price);
                     
                     bot.sendMessage(chatId, `✅ Package Added: ${name}\nGo back to see it and get the ID.`);
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
        showUserList(chatId, msgId, 0);
    }
    
    else if (data.startsWith('adm_u_pg_')) {
        const page = parseInt(data.split('_')[3]);
        showUserList(chatId, msgId, page);
    }
    
    else if (data === 'admin_add_user_manual') {
        const promptMsg = await bot.sendMessage(chatId, "➕ **Enter User ID to Add Manually:**", { reply_markup: { force_reply: true } });
        bot.onReplyToMessage(chatId, promptMsg.message_id, async (reply) => {
            const uid = reply.text.trim();
            if (/^\d+$/.test(uid)) {
                if (await db.add_user(uid)) {
                    bot.sendMessage(chatId, `✅ **User ${uid} Added!**`);
                } else {
                    bot.sendMessage(chatId, `⚠️ **User ${uid} already exists.**`);
                }
            } else {
                bot.sendMessage(chatId, "❌ Invalid ID.");
            }
        });
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
    startBroadcast(msg, text, null);
});

bot.on('photo', async (msg) => {
    if (!(await isAdmin(msg.from.id))) return;
    if (msg.caption && msg.caption.startsWith('/broadcast')) {
        const text = msg.caption.replace('/broadcast', '').trim();
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        startBroadcast(msg, text || "📢 Announcement", photoId);
    }
});

async function startBroadcast(msg, text, photoId) {
    const statusMsg = await bot.sendMessage(msg.chat.id, "⏳ Broadcasting...");
    
    // Get all users
    try {
        const res = await db.query("SELECT user_id FROM users");
        const users = res.rows;
        let count = 0;
        let blocked = 0;
        
        // Use a loop with delay
        for (const u of users) {
            try {
                if (photoId) {
                    await bot.sendPhoto(u.user_id, photoId, { caption: text, parse_mode: 'Markdown' });
                } else {
                    await bot.sendMessage(u.user_id, text, { parse_mode: 'Markdown' });
                }
                count++;
                await new Promise(r => setTimeout(r, 50)); // 50ms delay
            } catch (e) {
                blocked++;
            }
        }
        
        bot.editMessageText(`✅ **Broadcast Complete!**\nSent: ${count}\nBlocked: ${blocked}`, { chat_id: msg.chat.id, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    }
}

async function showUserList(chatId, msgId, page) {
    const limit = 10;
    const offset = page * limit;
    const users = await db.get_all_users(limit, offset);
    const totalUsers = await db.get_total_users_count();
    
    const inline_keyboard = [];
    
    users.forEach(u => {
        const display = u.username ? `@${u.username}` : u.user_id;
        // Clean display for button text (buttons don't support markdown but might have length limits)
        inline_keyboard.push([{ text: `👤 ${display} | 💰 ${u.balance}`, callback_data: `adm_user_dtl_${u.user_id}` }]);
    });
    
    // Pagination Controls
    const navRow = [];
    if (page > 0) {
        navRow.push({ text: "⬅️ Prev", callback_data: `adm_u_pg_${page - 1}` });
    }
    if (offset + limit < totalUsers) {
        navRow.push({ text: "Next ➡️", callback_data: `adm_u_pg_${page + 1}` });
    }
    if (navRow.length > 0) inline_keyboard.push(navRow);
    
    inline_keyboard.push([{ text: "🔍 Find User", callback_data: "admin_find_user" }]);
    inline_keyboard.push([{ text: "➕ Add User Manually", callback_data: "admin_add_user_manual" }]);
    inline_keyboard.push([{ text: "🔙 Back", callback_data: "admin_back_main" }]);
    
    const text = `👥 **User Management**\n\n📊 Total Users: **${totalUsers}**\n📄 Page: ${page + 1}`;
    
    bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
}

console.log("Bot setup complete.");
