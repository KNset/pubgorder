import telebot
from telebot import types
import json
import os
from datetime import datetime
import logging
import db  # Import database module
import midasbuy_auto # Import automation module
import json

# --- [၁] Configuration ---
API_TOKEN = '8591995558:AAH-_Fb-iCJ-ANeEiD8oqr0Qts3JlW8qStA'
ADMIN_ID = 1278018722
bot = telebot.TeleBot(API_TOKEN)

logging.basicConfig(level=logging.INFO)

# --- [၃] Main Menu (Always Ready Buttons) ---
def main_menu():
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, row_width=2)
    markup.add("🛒 Buy UC", "💰 Add Funds", "👤 Wallet", "📜 History")
    return markup

@bot.message_handler(commands=['start'])
def start(message):
    uid = message.from_user.id
    # Ensure user exists in DB
    user = db.get_user(uid)
    balance = user['balance']
    bot.send_message(message.chat.id, f"🎮 **JOE GAME SHOP မှ ကြိုဆိုပါတယ်!**\n💵 သင့်လက်ကျန်ငွေ: `{balance} MMK`", reply_markup=main_menu(), parse_mode="Markdown")

# --- [၄] Wallet & History Check ---
@bot.message_handler(func=lambda m: m.text == "👤 Wallet")
def check_wallet(message):
    user = db.get_user(message.from_user.id)
    balance = user['balance']
    bot.reply_to(message, f"👤 **သင့် Wallet အချက်အလက်**\n🆔 ID: `{message.from_user.id}`\n💵 လက်ကျန်ငွေ: `{balance} MMK`", parse_mode="Markdown")

@bot.message_handler(func=lambda m: m.text == "📜 History")
def show_history(message):
    uid = message.from_user.id
    history = db.get_history(uid)
    if not history: return bot.reply_to(message, "📜 ဝယ်ယူမှုမှတ်တမ်း မရှိသေးပါဘူးဗျ။")
    
    res = "📜 **နောက်ဆုံးဝယ်ယူမှု မှတ်တမ်းများ**\n"
    for item in history:
        res += f"━━━━━━━━━━━━━━\n📦 Pack: {item['package_name']}\n🎟 Code: `{item['code']}`\n📅 နေ့စွဲ: {item['purchase_date']}\n"
    bot.send_message(message.chat.id, res, parse_mode="Markdown")

# --- [၅] Add Funds (Top-up Notification with Username) ---
@bot.message_handler(func=lambda m: m.text == "💰 Add Funds")
def ask_amount(message):
    msg = bot.send_message(message.chat.id, "💰 **ငွေဖြည့်မည့် ပမာဏကို ရိုက်ထည့်ပါ -**")
    bot.register_next_step_handler(msg, process_deposit)

def process_deposit(message):
    if not message.text.isdigit():
        return bot.reply_to(message, "❌ ဂဏန်းသီးသန့်သာ ရိုက်ပေးပါဗျ။")
    amount = message.text
    
    methods = db.get_payment_methods()
    if not methods:
        return bot.send_message(message.chat.id, "❌ Payment methods not available. Please contact admin.")
        
    markup = types.InlineKeyboardMarkup(row_width=2)
    for m in methods:
        markup.add(types.InlineKeyboardButton(m['name'], callback_data=f"pay_{m['id']}_{amount}"))
    
    bot.send_message(message.chat.id, "� **ငွေပေးချေမည့် နည်းလမ်းကို ရွေးချယ်ပါ -**", reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data.startswith('pay_'))
def payment_method_selected(call):
    _, mid, amount = call.data.split('_')
    mid = int(mid)
    
    methods = db.get_payment_methods()
    method = next((m for m in methods if m['id'] == mid), None)
    
    if not method:
        return bot.answer_callback_query(call.id, "❌ Invalid Method")
        
    pay_msg = (
        f"� ပမာဏ: **{amount} MMK**\n\n"
        f"🏧 **{method['name']}**\n"
        f"━━━━━━━━━━━━━━\n"
        f"• **Account**: `{method['account_number']}`\n"
        f"• **Name**: **{method['account_name']}**\n"
        f"━━━━━━━━━━━━━━\n\n"
        "📸 **Guide:** ငွေလွှဲပြီးပါက Screenshot (ပြေစာ) ပို့ပေးပါဗျ။"
    )
    
    if method['qr_photo_id']:
        msg = bot.send_photo(call.message.chat.id, method['qr_photo_id'], caption=pay_msg, parse_mode="Markdown")
    else:
        msg = bot.send_message(call.message.chat.id, pay_msg, parse_mode="Markdown")
        
    bot.register_next_step_handler(msg, handle_ss, amount)

def handle_ss(message, amount):
    if message.content_type != 'photo':
        return bot.send_message(message.chat.id, "❌ Screenshot ပြေစာ ပို့ပေးရန် လိုအပ်ပါတယ်။")
    
    user = message.from_user
    username = f"@{user.username}" if user.username else "No Username"
    
    markup = types.InlineKeyboardMarkup()
    markup.add(types.InlineKeyboardButton("✅ Approve", callback_data=f"adm_ok_{amount}_{user.id}"),
               types.InlineKeyboardButton("❌ Reject", callback_data=f"adm_no_{amount}_{user.id}"))
    
    try:
        # Escape special characters for MarkdownV2 or just remove Markdown parsing for user input fields
        # Using HTML or no parse mode is safer for user input mixed with static text
        
        caption = (
            f"💰 Deposit Request\n"
            f"👤 User: {user.first_name} {user.last_name if user.last_name else ''}\n"
            f"🔗 Username: {username}\n"
            f"🆔 ID: {user.id}\n"
            f"💵 Amount: {amount} MMK"
        )
        
        bot.send_photo(ADMIN_ID, message.photo[-1].file_id, 
                       caption=caption, 
                       reply_markup=markup) # Removed parse_mode="Markdown"
        bot.send_message(message.chat.id, "✅ Admin အတည်ပြုချက်အတွက် ပို့လိုက်ပါပြီ။")
    except Exception as e:
        logging.error(f"Error sending photo to admin: {e}")
        bot.send_message(message.chat.id, "❌ Error sending request to admin. Please try again.")

# --- [၆] Buy UC (With Confirmation Flow) ---
@bot.message_handler(func=lambda m: m.text == "🛒 Buy UC")
def shop_menu(message):
    uc_details = db.get_packages()
    markup = types.InlineKeyboardMarkup(row_width=1)
    for k, v in uc_details.items():
        markup.add(types.InlineKeyboardButton(f"🎮 {v['name']} - {v['price']} MMK", callback_data=f"pre_{k}"))
    bot.send_message(message.chat.id, "ဝယ်ယူလိုသော Package ကို ရွေးချယ်ပါ -", reply_markup=markup)

@bot.callback_query_handler(func=lambda c: c.data.startswith('pre_'))
def pre_purchase(call):
    pk = call.data.split('_')[1]
    uc_details = db.get_packages()
    if pk not in uc_details:
        return bot.answer_callback_query(call.id, "❌ Package မရှိတော့ပါ", show_alert=True)
    pack = uc_details[pk]
    
    markup = types.InlineKeyboardMarkup()
    markup.add(types.InlineKeyboardButton("✅ Confirm Purchase", callback_data=f"buy_{pk}"),
               types.InlineKeyboardButton("❌ Cancel", callback_data="cancel_order"))
    
    confirm_text = (
        f"❓ **ဝယ်ယူမှုကို အတည်ပြုပါ**\n\n"
        f"📦 Pack: **{pack['name']}**\n"
        f"💵 ကျသင့်ငွေ: **{pack['price']} MMK**\n\n"
        "တကယ်ဝယ်ယူမှာ သေချာပါသလား?"
    )
    bot.edit_message_text(confirm_text, call.message.chat.id, call.message.message_id, reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data == "cancel_order")
def cancel_order(call):
    bot.edit_message_text("❌ ဝယ်ယူမှုကို ဖျက်သိမ်းလိုက်ပါပြီ။", call.message.chat.id, call.message.message_id)

@bot.callback_query_handler(func=lambda c: c.data.startswith('buy_'))
def execute_purchase(call):
    pk = call.data.split('_')[1]
    uc_details = db.get_packages()
    if pk not in uc_details:
        return bot.answer_callback_query(call.id, "❌ Package မရှိတော့ပါ", show_alert=True)
    
    uid = call.from_user.id
    user = db.get_user(uid)
    price = uc_details[pk]['price']
    
    if user['balance'] >= price:
        # Check if stock is available (peek)
        cnt = db.get_stock_count(pk)
        if cnt > 0:
            # Ask for Player ID
            msg = bot.send_message(call.message.chat.id, "🆔 **ကျေးဇူးပြု၍ PUBG Player ID (UID) ရိုက်ထည့်ပါ:**", parse_mode="Markdown")
            bot.register_next_step_handler(msg, process_player_id, pk, price, uc_details[pk]['name'])
            bot.delete_message(call.message.chat.id, call.message.message_id)
        else:
            bot.answer_callback_query(call.id, "⚠️ Stock ပြတ်နေပါသည်။", show_alert=True)
    else:
        bot.answer_callback_query(call.id, "❌ လက်ကျန်ငွေ မလုံလောက်ပါ။", show_alert=True)

def process_player_id(message, pk, price, pkg_name):
    if not message.text.isdigit():
        return bot.reply_to(message, "❌ UID သည် ဂဏန်းများသာ ဖြစ်ရပါမည်။ ပြန်လည်ရွေးချယ်ပါ။")
    
    player_id = message.text
    uid = message.from_user.id
    
    # Final Confirmation
    markup = types.InlineKeyboardMarkup()
    markup.add(types.InlineKeyboardButton("✅ Confirm Top-up", callback_data=f"final_{pk}_{player_id}"),
               types.InlineKeyboardButton("❌ Cancel", callback_data="cancel_order"))
    
    bot.send_message(message.chat.id, 
                     f"❓ **အတည်ပြုပါ**\n\n📦 Pack: **{pkg_name}**\n🆔 UID: `{player_id}`\n💵 Cost: `{price} MMK`", 
                     reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data.startswith('final_'))
def final_process(call):
    _, pk, player_id = call.data.split('_')
    uid = call.from_user.id
    
    uc_details = db.get_packages()
    if pk not in uc_details:
        return bot.answer_callback_query(call.id, "❌ Error", show_alert=True)
        
    price = uc_details[pk]['price']
    user = db.get_user(uid)
    
    if user['balance'] < price:
        return bot.answer_callback_query(call.id, "❌ လက်ကျန်ငွေ မလုံလောက်ပါ။", show_alert=True)
        
    # 1. Get Code
    code = db.get_and_use_stock(pk)
    if not code:
        return bot.answer_callback_query(call.id, "⚠️ Stock ပြတ်သွားပါပြီ။", show_alert=True)
        
    # 2. Deduct Balance (Temporary hold, refund if fail?)
    # Ideally: Deduct -> Try Redeem -> If fail, Refund.
    db.update_balance(uid, -price)
    
    bot.edit_message_text("⏳ **Processing Top-up... Please wait (1-2 mins)**", call.message.chat.id, call.message.message_id, parse_mode="Markdown")
    
    # 3. Call Automation
    result = midasbuy_auto.redeem_code(player_id, code)
    
    if result['success']:
        # Success
        db.add_history(uid, uc_details[pk]['name'], f"Direct: {code}")
        
        bot.send_message(uid, f"✅ **Top-up Successful!**\n\n📦 {uc_details[pk]['name']}\n🆔 UID: `{player_id}`\n🎉 Enjoy!", parse_mode="Markdown")
        bot.send_message(ADMIN_ID, f"🛒 **Auto-Topup Success**\n👤 User: @{call.from_user.username}\n🆔 UID: `{player_id}`\n📦 Pack: {uc_details[pk]['name']}\n🎟 Code Used: `{code}`")
    else:
        # Failed - Refund and Notify Admin
        db.update_balance(uid, price) # Refund
        # Ideally we should re-add stock, but for now let's just log it to admin to handle the code manually
        
        bot.send_message(uid, f"❌ **Top-up Failed**\n{result['message']}\n💰 ပိုက်ဆံပြန်အမ်းလိုက်ပါပြီ။", parse_mode="Markdown")
        bot.send_message(ADMIN_ID, f"⚠️ **Auto-Topup FAILED**\n👤 User: @{call.from_user.username}\n🆔 UID: `{player_id}`\n🎟 Code: `{code}`\n❌ Reason: {result['message']}\nℹ️ Code was consumed from DB but User refunded.")

# --- [၇] Admin Controls (Add Stock & Approval) ---
@bot.message_handler(commands=['add'])
def admin_add_stock(message):
    if message.from_user.id != ADMIN_ID: return
    
    args = message.text.split()[1:]
    
    if not args:
         return bot.reply_to(message, "⚠️ Usage: `/add [Pack] [Code1] [Code2] ...`\nExample: `/add 60 CODE1 CODE2 325 CODE3`")
    
    results = []
    uc_details = db.get_packages()
    current_pack = None
    
    for token in args:
        # Check if token is a Package Identifier
        if token in uc_details:
            current_pack = token
            results.append(f"📂 **Set Package:** {uc_details[token]['name']}")
            continue
            
        # If not a package, treat as code for current_pack
        if current_pack:
            if db.add_stock(current_pack, token):
                results.append(f"  ✅ {token}: Added")
            else:
                results.append(f"  ⚠️ {token}: Duplicate")
        else:
            results.append(f"❌ {token}: Skipped (No package specified)")
            
    report = "\n".join(results)
    if len(report) > 4000:
        report = report[:4000] + "\n...(truncated)"
        
    bot.reply_to(message, f"📦 **Stock Add Report**\n{report}", parse_mode="Markdown")

@bot.message_handler(commands=['checkstock'])
def admin_check_stock(message):
    if message.from_user.id != ADMIN_ID: return
    uc_details = db.get_packages()
    report = "📦 **လက်ရှိ Stock စာရင်း**\n"
    for k, v in uc_details.items():
        cnt = db.get_stock_count(k)
        report += f"🔹 {v['name']}: **{cnt}** ခုကျန်\n"
    bot.send_message(message.chat.id, report, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data.startswith('adm_ok_') or c.data.startswith('adm_no_'))
def admin_approval(call):
    _, action, amt, uid = call.data.split('_')
    uid = int(uid)
    amt = int(amt)
    
    if action == "ok":
        db.update_balance(uid, amt)
        user = db.get_user(uid)
        bot.send_message(uid, f"✅ **ငွေဖြည့်သွင်းမှု အောင်မြင်သည်!**\n💰 လက်ကျန်: `{user['balance']} MMK`", parse_mode="Markdown")
        bot.edit_message_caption("🟢 Approved", call.message.chat.id, call.message.message_id)
    else:
        bot.send_message(uid, f"❌ **ငွေဖြည့်သွင်းမှု ငြင်းပယ်ခံရပါသည်!**\n💰 Amount: `{amt} MMK`\nℹ️ အသေးစိတ်သိရှိလိုပါက Admin ကို ဆက်သွယ်ပါ။", parse_mode="Markdown")
        bot.edit_message_caption("🔴 Rejected", call.message.chat.id, call.message.message_id)

@bot.message_handler(commands=['setcookies'])
def admin_set_cookies(message):
    if message.from_user.id != ADMIN_ID: return
    
    # Check if message is too long or split (Telegram splits long messages)
    # But here we only get one message object.
    # If the user sends a very long text, Telegram client might split it, but Bot API usually receives up to 4096 chars.
    # Cookies can easily exceed 4096 chars.
    
    # Solution: Tell user to use FILE upload for long cookies.
    if len(message.text) > 3000: # Heuristic warning
         bot.reply_to(message, "⚠️ Text is very long. Telegram might have cut it off. \n\n✅ **Better:** Save cookies as `.json` or `.txt` file and drag-and-drop it here!")

    try:
        # Get text
        json_str = message.text.replace('/setcookies', '').strip()
        
        # 1. Fix Smart Quotes (Windows/iOS issue)
        json_str = json_str.replace('“', '"').replace('”', '"').replace("‘", "'").replace("’", "'")
        
        # 2. Fix unquoted keys (Common JS object format)
        # e.g. {domain: ".midasbuy.com"} -> {"domain": ".midasbuy.com"}
        import re
        # Pattern: find words followed by colon, not inside quotes
        # This is a basic regex and might not cover all cases but handles simple ones
        json_str = re.sub(r'(?<!")(\b\w+\b)(?=\s*:)', r'"\1"', json_str)
        
        # 3. Extract JSON array part
        # Logic: Find the OUTERMOST [] or {}
        # If there are multiple objects separated by commas but not in a list, wrap them.
        
        # Simple heuristic: If text contains multiple `{...}, {...}`, wrap in `[...]`
        if json_str.count('},{') > 0 and not json_str.strip().startswith('['):
             json_str = f"[{json_str}]"
        
        start = json_str.find('[')
        end = json_str.rfind(']') + 1
        
        # New: Also support single object {...} if user pasted just one cookie or a dict wrapper
        start_obj = json_str.find('{')
        end_obj = json_str.rfind('}') + 1
        
        if start != -1 and end != 0:
            # If array exists, prefer it
            # But ensure we are not cutting off if there are multiple arrays? (unlikely for cookies)
            json_str = json_str[start:end]
        elif start_obj != -1 and end_obj != 0:
            # Maybe it's a single object or wrapper
            json_str = json_str[start_obj:end_obj]
            # Wrap in list if it's a single cookie
            if not json_str.strip().startswith('{ "cookies":'): 
                 # We'll let json.loads decide, but later wrap it
                 pass
        else:
            # Last attempt: Maybe it's just raw header string? 
            # e.g. "uuid=...; session=..."
            # We can try to convert this to cookie format
            if '=' in json_str and ';' in json_str:
                cookies = []
                for pair in json_str.split(';'):
                    if '=' in pair:
                        k, v = pair.split('=', 1)
                        cookies.append({'name': k.strip(), 'value': v.strip(), 'domain': '.midasbuy.com'})
                
                db.set_api_config('midasbuy', {'cookies': cookies})
                return bot.reply_to(message, f"✅ Parsed Raw Cookie String! ({len(cookies)} cookies saved)")
            
            return bot.reply_to(message, "⚠️ No JSON array `[...]` or valid cookie string found.")

        # 4. Final cleaning: remove trailing commas (invalid in JSON but common in JS)
        json_str = re.sub(r',\s*([\]}])', r'\1', json_str)

        try:
            cookies = json.loads(json_str)
        except json.JSONDecodeError as e:
            # Last resort: Try ast.literal_eval for Python-like dict strings
            import ast
            try:
                cookies = ast.literal_eval(json_str)
            except:
                return bot.reply_to(message, f"❌ JSON Error: {e.msg}\nPos: {e.pos}\nSnippet: `{json_str[max(0, e.pos-10):min(len(json_str), e.pos+10)]}`")

        if not isinstance(cookies, list):
            if isinstance(cookies, dict):
                # Check for "cookies" key
                if 'cookies' in cookies:
                    cookies = cookies['cookies']
                else:
                    # Treat the dict itself as a single cookie?
                    # Or maybe it's {name:..., value:...}
                    if 'name' in cookies and 'value' in cookies:
                        cookies = [cookies]
                    else:
                        # Maybe it's a key-value map like {"uuid": "123", "token": "abc"}
                        # Convert to list
                        new_cookies = []
                        for k, v in cookies.items():
                            if isinstance(v, str):
                                new_cookies.append({'name': k, 'value': v, 'domain': '.midasbuy.com'})
                        if new_cookies:
                            cookies = new_cookies
                        else:
                            return bot.reply_to(message, "❌ Invalid format. Could not extract cookies from object.")
            else:
                return bot.reply_to(message, "❌ Invalid format. Must be a list `[...]`.")
            
        db.set_api_config('midasbuy', {'cookies': cookies})
        bot.reply_to(message, f"✅ Midasbuy Cookies updated! ({len(cookies)} cookies saved)")
        
    except Exception as e:
        bot.reply_to(message, f"❌ Error: {e}")

@bot.message_handler(content_types=['document'])
def admin_upload_cookies_file(message):
    if message.from_user.id != ADMIN_ID: return
    
    is_cookie_file = message.document.file_name.endswith('.json') or (message.caption and '/setcookies' in message.caption)
    
    if is_cookie_file:
        try:
            file_info = bot.get_file(message.document.file_id)
            downloaded_file = bot.download_file(file_info.file_path)
            content = downloaded_file.decode('utf-8')
            
            # Try to find JSON array
            start = content.find('[')
            end = content.rfind(']') + 1
            if start != -1 and end != 0:
                content = content[start:end]
            
            cookies = json.loads(content)
            
            if isinstance(cookies, list):
                db.set_api_config('midasbuy', {'cookies': cookies})
                bot.reply_to(message, f"✅ Midasbuy Cookies updated from file successfully! ({len(cookies)} cookies)")
            else:
                bot.reply_to(message, "❌ Invalid JSON format. The file must contain a list of cookie objects.")
        except Exception as e:
            bot.reply_to(message, f"❌ Error processing file: {e}")

# --- [၈] Admin Dashboard (Price & Package Management) ---

@bot.message_handler(commands=['admin'])
def admin_dashboard(message):
    if message.from_user.id != ADMIN_ID: return
    markup = types.InlineKeyboardMarkup(row_width=1)
    markup.add(
        types.InlineKeyboardButton("📊 Check Stock", callback_data="admin_check_stock"),
        types.InlineKeyboardButton("📦 Manage Packages", callback_data="admin_manage_packages"),
        types.InlineKeyboardButton("➕ Add New Package", callback_data="admin_add_package"),
        types.InlineKeyboardButton("💳 Manage Payments", callback_data="admin_manage_payments"),
        types.InlineKeyboardButton("❌ Close", callback_data="admin_close")
    )
    bot.send_message(message.chat.id, "🔧 **Admin Dashboard**", reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data == "admin_check_stock")
def admin_check_stock_callback(call):
    uc_details = db.get_packages()
    report = "📦 **လက်ရှိ Stock စာရင်း**\n"
    for k, v in uc_details.items():
        cnt = db.get_stock_count(k)
        report += f"🔹 {v['name']}: **{cnt}** ခုကျန်\n"
    
    markup = types.InlineKeyboardMarkup()
    markup.add(types.InlineKeyboardButton("🔙 Back", callback_data="admin_back_main"))
    
    bot.edit_message_text(report, call.message.chat.id, call.message.message_id, reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data == "admin_close")
def admin_close(call):
    bot.delete_message(call.message.chat.id, call.message.message_id)

@bot.callback_query_handler(func=lambda c: c.data == "admin_manage_packages")
def admin_manage_packages(call):
    uc_details = db.get_packages()
    markup = types.InlineKeyboardMarkup(row_width=1)
    for k, v in uc_details.items():
        markup.add(types.InlineKeyboardButton(f"{v['name']} ({v['price']} MMK)", callback_data=f"adm_pkg_{k}"))
    markup.add(types.InlineKeyboardButton("🔙 Back", callback_data="admin_back_main"))
    bot.edit_message_text("📦 **Select Package to Edit/Delete:**", call.message.chat.id, call.message.message_id, reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data == "admin_back_main")
def admin_back_main(call):
    markup = types.InlineKeyboardMarkup(row_width=1)
    markup.add(
        types.InlineKeyboardButton("📊 Check Stock", callback_data="admin_check_stock"),
        types.InlineKeyboardButton("📦 Manage Packages", callback_data="admin_manage_packages"),
        types.InlineKeyboardButton("➕ Add New Package", callback_data="admin_add_package"),
        types.InlineKeyboardButton("💳 Manage Payments", callback_data="admin_manage_payments"),
        types.InlineKeyboardButton("❌ Close", callback_data="admin_close")
    )
    bot.edit_message_text("🔧 **Admin Dashboard**", call.message.chat.id, call.message.message_id, reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data == "admin_manage_payments")
def admin_manage_payments(call):
    methods = db.get_payment_methods()
    markup = types.InlineKeyboardMarkup(row_width=1)
    for m in methods:
        markup.add(types.InlineKeyboardButton(f"{m['name']} - {m['account_name']}", callback_data=f"adm_pay_{m['id']}"))
    markup.add(types.InlineKeyboardButton("➕ Add New Payment", callback_data="admin_add_payment"))
    markup.add(types.InlineKeyboardButton("🔙 Back", callback_data="admin_back_main"))
    bot.edit_message_text("💳 **Manage Payment Methods:**", call.message.chat.id, call.message.message_id, reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data.startswith('adm_pay_'))
def admin_payment_detail(call):
    mid = int(call.data.split('_')[2])
    methods = db.get_payment_methods()
    method = next((m for m in methods if m['id'] == mid), None)
    
    if not method: return bot.answer_callback_query(call.id, "❌ Method not found")
    
    markup = types.InlineKeyboardMarkup(row_width=1)
    markup.add(types.InlineKeyboardButton("🗑 Delete", callback_data=f"adm_del_pay_{mid}"))
    markup.add(types.InlineKeyboardButton("🔙 Back", callback_data="admin_manage_payments"))
    
    text = (f"💳 **Payment Detail**\n\n"
            f"📛 Name: {method['name']}\n"
            f"🔢 Acc: `{method['account_number']}`\n"
            f"👤 Owner: {method['account_name']}")
            
    bot.edit_message_text(text, call.message.chat.id, call.message.message_id, reply_markup=markup, parse_mode="Markdown")

@bot.callback_query_handler(func=lambda c: c.data.startswith('adm_del_pay_'))
def admin_delete_payment(call):
    mid = int(call.data.split('_')[3])
    db.delete_payment_method(mid)
    bot.answer_callback_query(call.id, "✅ Deleted", show_alert=True)
    admin_manage_payments(call)

# Add Payment Flow
@bot.callback_query_handler(func=lambda c: c.data == "admin_add_payment")
def admin_add_payment_start(call):
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("❌ Cancel")
    msg = bot.send_message(call.message.chat.id, "📛 **Enter Payment Name (e.g., KBZ Pay):**", reply_markup=markup)
    bot.register_next_step_handler(msg, admin_add_pay_name)

def admin_add_pay_name(message):
    if message.text == "❌ Cancel":
        return bot.send_message(message.chat.id, "❌ Cancelled.", reply_markup=types.ReplyKeyboardRemove())
    name = message.text
    
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("❌ Cancel")
    msg = bot.send_message(message.chat.id, f"🔢 **Enter Account Number for {name}:**", reply_markup=markup)
    bot.register_next_step_handler(msg, admin_add_pay_acc, name)

def admin_add_pay_acc(message, name):
    if message.text == "❌ Cancel":
        return bot.send_message(message.chat.id, "❌ Cancelled.", reply_markup=types.ReplyKeyboardRemove())
    acc = message.text
    
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("❌ Cancel")
    msg = bot.send_message(message.chat.id, f"👤 **Enter Account Name for {acc}:**", reply_markup=markup)
    bot.register_next_step_handler(msg, admin_add_pay_owner, name, acc)

def admin_add_pay_owner(message, name, acc):
    if message.text == "❌ Cancel":
        return bot.send_message(message.chat.id, "❌ Cancelled.", reply_markup=types.ReplyKeyboardRemove())
    owner = message.text
    
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("❌ Cancel", "⏩ Skip QR")
    msg = bot.send_message(message.chat.id, "📸 **Send QR Code Photo (or press Skip):**", reply_markup=markup)
    bot.register_next_step_handler(msg, admin_add_pay_qr, name, acc, owner)

def admin_add_pay_qr(message, name, acc, owner):
    qr_id = None
    if message.content_type == 'photo':
        qr_id = message.photo[-1].file_id
    elif message.text == "⏩ Skip QR":
        qr_id = None
    elif message.text == "❌ Cancel":
        return bot.send_message(message.chat.id, "❌ Cancelled.", reply_markup=types.ReplyKeyboardRemove())
    else:
        markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
        markup.add("❌ Cancel", "⏩ Skip QR")
        msg = bot.send_message(message.chat.id, "⚠️ Please send a Photo or Skip.", reply_markup=markup)
        return bot.register_next_step_handler(msg, admin_add_pay_qr, name, acc, owner)
        
    db.add_payment_method(name, acc, owner, qr_id)
    bot.send_message(message.chat.id, f"✅ **Payment Method Added!**\n{name} - {acc}", reply_markup=types.ReplyKeyboardRemove())

@bot.callback_query_handler(func=lambda c: c.data.startswith('adm_pkg_'))
def admin_package_detail(call):
    pk = call.data.split('_')[2]
    uc_details = db.get_packages()
    if pk not in uc_details:
        return bot.answer_callback_query(call.id, "❌ Package Not Found", show_alert=True)
    
    pack = uc_details[pk]
    markup = types.InlineKeyboardMarkup(row_width=2)
    markup.add(
        types.InlineKeyboardButton("✏️ Edit Price", callback_data=f"adm_edit_price_{pk}"),
        types.InlineKeyboardButton("🗑 Delete", callback_data=f"adm_del_pkg_{pk}")
    )
    markup.add(types.InlineKeyboardButton("🔙 Back", callback_data="admin_manage_packages"))
    
    text = f"📦 **Package Details**\n\n🆔 ID: `{pk}`\n📛 Name: `{pack['name']}`\n💵 Price: `{pack['price']} MMK`"
    bot.edit_message_text(text, call.message.chat.id, call.message.message_id, reply_markup=markup, parse_mode="Markdown")

# Add Package Flow
@bot.callback_query_handler(func=lambda c: c.data == "admin_add_package")
def admin_add_package_start(call):
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("❌ Cancel")
    msg = bot.send_message(call.message.chat.id, "➕ **Enter New Package Identifier (e.g., 90, 600):**", reply_markup=markup)
    bot.register_next_step_handler(msg, admin_add_package_id)

def admin_add_package_id(message):
    if message.text == "❌ Cancel":
        return bot.send_message(message.chat.id, "❌ Process Cancelled.", reply_markup=types.ReplyKeyboardRemove())
        
    pk_id = message.text.strip()
    
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("❌ Cancel")
    msg = bot.send_message(message.chat.id, f"📛 **Enter Name for {pk_id} (e.g., 90 UC):**", reply_markup=markup)
    bot.register_next_step_handler(msg, admin_add_package_name, pk_id)

def admin_add_package_name(message, pk_id):
    if message.text == "❌ Cancel":
        return bot.send_message(message.chat.id, "❌ Process Cancelled.", reply_markup=types.ReplyKeyboardRemove())
        
    name = message.text.strip()
    
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("❌ Cancel")
    msg = bot.send_message(message.chat.id, f"💵 **Enter Price for {name} (Numbers only):**", reply_markup=markup)
    bot.register_next_step_handler(msg, admin_add_package_price, pk_id, name)

def admin_add_package_price(message, pk_id, name):
    if message.text == "❌ Cancel":
        return bot.send_message(message.chat.id, "❌ Process Cancelled.", reply_markup=types.ReplyKeyboardRemove())
        
    if not message.text.isdigit():
        markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
        markup.add("❌ Cancel")
        msg = bot.send_message(message.chat.id, "❌ Price must be a number. Try again:", reply_markup=markup)
        return bot.register_next_step_handler(msg, admin_add_package_price, pk_id, name)
        
    price = int(message.text)
    if db.add_package(pk_id, name, price):
        bot.send_message(message.chat.id, f"✅ **Package Added!**\n{name} - {price} MMK", reply_markup=types.ReplyKeyboardRemove())
    else:
        bot.send_message(message.chat.id, "❌ Failed to add. Identifier might already exist.", reply_markup=types.ReplyKeyboardRemove())

# Edit Price Flow
@bot.callback_query_handler(func=lambda c: c.data.startswith('adm_edit_price_'))
def admin_edit_price_start(call):
    pk = call.data.split('_')[3]
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    markup.add("❌ Cancel")
    msg = bot.send_message(call.message.chat.id, f"💵 **Enter New Price for Package {pk}:**", reply_markup=markup)
    bot.register_next_step_handler(msg, admin_edit_price_save, pk)

def admin_edit_price_save(message, pk):
    if message.text == "❌ Cancel":
        return bot.send_message(message.chat.id, "❌ Process Cancelled.", reply_markup=types.ReplyKeyboardRemove())

    if not message.text.isdigit():
        return bot.send_message(message.chat.id, "❌ Price must be a number. Process Cancelled.", reply_markup=types.ReplyKeyboardRemove())
    price = int(message.text)
    if db.update_package_price(pk, price):
        bot.send_message(message.chat.id, f"✅ **Price Updated!**", reply_markup=types.ReplyKeyboardRemove())
    else:
        bot.send_message(message.chat.id, "❌ Failed to update.", reply_markup=types.ReplyKeyboardRemove())

# Delete Package Flow
@bot.callback_query_handler(func=lambda c: c.data.startswith('adm_del_pkg_'))
def admin_delete_package(call):
    pk = call.data.split('_')[3]
    if db.delete_package(pk):
        bot.answer_callback_query(call.id, "✅ Package Deleted", show_alert=True)
        admin_manage_packages(call) # Refresh list
    else:
        bot.answer_callback_query(call.id, "❌ Failed to delete", show_alert=True)

if __name__ == "__main__":
    db.init_db()
    print("Bot is running...")
    bot.infinity_polling(timeout=10, long_polling_timeout=5)