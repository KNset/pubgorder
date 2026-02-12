from playwright.sync_api import sync_playwright
import time
import json
import db
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def handle_promotional_popup(page):
    """Detect and close promotional popups/iframes"""
    logger.info("🛡️ Checking for promotional popups...")
    
    try:
        removed = page.evaluate("""() => {
            // Target the specific iframe wrapper mentioned in error log
            const pagedoo = document.querySelector('.activity-iframe-wrapper.pagedoo-pc.open');
            if (pagedoo) {
                pagedoo.remove();
                return 'Pagedoo iframe wrapper removed';
            }
            
            // Generic pagedoo iframe
            const iframe = document.querySelector('iframe[src*="act/pagedoo"]');
            if (iframe) {
                // Try to find container
                const container = iframe.closest('.activity-iframe-wrapper') || iframe.parentElement;
                if (container) {
                    container.remove();
                    return 'Promotional iframe container removed';
                }
                iframe.remove();
                return 'Promotional iframe removed';
            }

            // Also check for activity dialogs
            const activityDialog = document.querySelector('[class*="activity_dialog"]');
            if (activityDialog) {
                activityDialog.remove();
                return 'Activity dialog removed';
            }
            
            return false;
        }""")
        
        if removed:
            logger.info(f"✅ Popup handled: {removed}")
            time.sleep(0.5)
            return True
    except Exception as e:
        logger.warning(f"⚠️ Error checking popup: {e}")
    return False

def clear_and_enter_player_id(page, new_player_id):
    """Clear existing Player ID and enter new one"""
    logger.info(f"🔄 Changing Player ID to: {new_player_id}")
    
    handle_promotional_popup(page)

    try:
        # Check if popup is already open
        popup_already_open = page.evaluate("""() => {
            const input = document.querySelector('input[placeholder="Enter Player ID"]');
            return input && input.offsetParent !== null;
        }""")

        if popup_already_open:
            logger.info("✅ Player ID popup is already open")
        else:
            # Click switch icon
            logger.info("1. Opening Player ID popup...")
            switch_clicked = page.evaluate("""() => {
                let switchIcon = document.querySelector('.UserDataBox_switch_btn__q0ZYA') || document.querySelector('[class*="switch_btn"]');
                if (switchIcon) {
                    switchIcon.click();
                    return true;
                }
                return false;
            }""")
            
            if not switch_clicked:
                logger.error("❌ Could not find switch icon")
                return False
            
            time.sleep(1)
            
            # Check if popup opened
            popup_exists = page.evaluate("""() => {
                const input = document.querySelector('input[placeholder="Enter Player ID"]');
                return input && input.offsetParent !== null;
            }""")
            
            if not popup_exists:
                logger.error("❌ Player ID popup did not open")
                return False

        # Clear existing ID
        logger.info("2. Clearing existing Player ID...")
        try:
            page.click('input[maxlength="30"][type="text"][placeholder="Enter Player ID"]', timeout=5000)
        except:
            page.click('.SelectServerBox_input_wrap_box__qq+Iq input', timeout=5000)

        time.sleep(0.3)
        page.keyboard.press("Control+A")
        time.sleep(0.2)
        page.keyboard.press("Delete")
        time.sleep(0.3)
        
        # Enter new ID
        logger.info(f"4. Entering new Player ID: {new_player_id}")
        page.keyboard.type(new_player_id, delay=40)
        time.sleep(0.6)
        
        # Confirm
        logger.info("5. Clicking OK to confirm...")
        handle_promotional_popup(page)
        
        ok_button = page.locator('.BindLoginPop_btn_wrap__eiPwz .Button_btn__P0ibl').first
        if ok_button.count() > 0:
            ok_button.click()
        else:
            # Fallback JS click
            page.evaluate("""() => {
                const buttons = document.querySelectorAll('.Button_text__WeIeb');
                for (const btn of buttons) {
                    if (btn.textContent && btn.textContent.trim() === 'OK') {
                        const button = btn.closest('.Button_btn__P0ibl');
                        if (button) button.click();
                    }
                }
            }""")
            
        time.sleep(1)
        
        # Verify change
        current_id_display = page.evaluate("""() => {
            const idElement = document.querySelector('.UserDataBox_sub_text__laXQu');
            return idElement ? idElement.textContent : '';
        }""")
        
        if new_player_id in current_id_display:
            logger.info(f"🎉 Successfully changed to Player ID: {new_player_id}")
            return True
        else:
            logger.warning(f"⚠️ Player ID display mismatch: {current_id_display} vs {new_player_id}")
            return False

    except Exception as e:
        logger.error(f"❌ Error changing Player ID: {e}")
        return False

def redeem_code(player_id, code):
    """Main redemption function"""
    logger.info(f"🎁 Starting redemption for {player_id} with code {code}")
    
    # Get Cookies from DB
    config = db.get_api_config('midasbuy')
    if not config or 'cookies' not in config:
        logger.error("❌ No Midasbuy cookies found in DB")
        return {"success": False, "message": "Admin configuration error: No cookies found."}
        
    cookies = config['cookies']
    
    # Fix cookies sameSite attribute
    for c in cookies:
        c['sameSite'] = 'Lax'

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            viewport={'width': 1280, 'height': 800}
        )
        
        try:
            context.add_cookies(cookies)
            page = context.new_page()
            
            logger.info("🌐 Loading Midasbuy...")
            try:
                page.goto("https://www.midasbuy.com/midasbuy/mm/redeem/pubgm", timeout=60000, wait_until='domcontentloaded')
                page.wait_for_selector('[class*="switch_btn"]', timeout=30000)
            except Exception as e:
                logger.error(f"Navigation error: {e}")
                return {"success": False, "message": "Failed to load Midasbuy page."}

            handle_promotional_popup(page)
            time.sleep(2) # Delay after popup check
            
            # Change Player ID
            if not clear_and_enter_player_id(page, player_id):
                return {"success": False, "message": "Failed to verify Player ID. Please check if ID is correct."}
            
            time.sleep(2) # Delay after Player ID change
                
            # Enter Code
            logger.info(f"⌨️ Entering redeem code: {code}")
            
            # Robust Input Finding (Prioritize selectors from midasbuy.js)
            input_found = False
            selectors = [
                '.Input_input__s4ezt input[type="text"]', # midasbuy.js selector
                'input[placeholder*="Redeem Code"]', 
                'input[placeholder*="redeem code"]',
                '[class*="RedeemStepBox"] input'
            ]
            
            for sel in selectors:
                try:
                    if page.locator(sel).count() > 0:
                        page.click(sel, timeout=1000)
                        input_found = True
                        break
                except: continue
                
            if not input_found:
                # Last resort JS focus
                page.evaluate("""() => {
                    const inputs = document.querySelectorAll('input');
                    for(const inp of inputs) {
                        if(inp.placeholder.toLowerCase().includes('redeem')) {
                            inp.focus();
                            inp.click();
                        }
                    }
                }""")
            
            time.sleep(1)
            page.keyboard.press("Control+A")
            page.keyboard.press("Delete")
            page.keyboard.type(code, delay=100) # Slower typing
            time.sleep(1.5) # Delay after typing code
            
            # Click OK (Redeem)
            logger.info("🔘 Clicking Redeem OK...")
            
            # Robust Button Clicking (Prioritize selectors from midasbuy.js)
            page.evaluate("""() => {
                // Helper to click
                function clickBtn(btn) {
                    if(!btn) return false;
                    try {
                        // Logic from midasbuy.js to enable button
                        if (btn.classList.contains('Button_disable__fVSbn')) {
                            btn.classList.remove('Button_disable__fVSbn');
                            btn.style.pointerEvents = 'auto';
                        }
                        btn.click();
                        return true;
                    } catch(e) { return false; }
                }

                // 1. Try exact selector from midasbuy.js
                const jsButton = document.querySelector('.RedeemStepBox_btn_wrap__wEKY9 .Button_btn__P0ibl');
                if (clickBtn(jsButton)) return;

                // 2. Try finding OK button inside RedeemStepBox (Most specific)
                const container = document.querySelector('[class*="RedeemStepBox"]');
                if (container) {
                    const okBtns = Array.from(container.querySelectorAll('button, [class*="Button_btn"]'));
                    for (const btn of okBtns) {
                        if (btn.textContent.trim() === 'OK') {
                            if(clickBtn(btn)) return;
                        }
                    }
                }
                
                // 3. Try generic OK button that appears after the input
                const allOkBtns = Array.from(document.querySelectorAll('button, [class*="Button_btn"]'));
                // Reverse to find the one further down (Redeem is usually below Player ID)
                for (const btn of allOkBtns.reverse()) {
                    if (btn.textContent.trim() === 'OK' && btn.offsetParent !== null) { // Visible
                         // Avoid the Player ID OK button if possible (usually higher up)
                         clickBtn(btn);
                         return;
                    }
                }
            }""")
            time.sleep(3) # Increased delay after clicking Redeem OK

            # ------------------------------------------------------------------
            # CAPTCHA HANDLING START
            # ------------------------------------------------------------------
            logger.info("🛡️ Checking for Captcha (Slider)...")
            
            # Try to detect iframe with captcha
            # Midasbuy/Tencent Captcha usually loads in an iframe with src containing 'captcha' or 't-captcha'
            # We need to wait a bit to see if it appears
            time.sleep(2)
            
            captcha_iframe = None
            try:
                # Find all iframes
                frames = page.frames
                for frame in frames:
                    if 'captcha' in frame.url or 't-captcha' in frame.url:
                        captcha_iframe = frame
                        break
            except: pass
            
            if captcha_iframe:
                logger.info("⚠️ Captcha Iframe Detected! Attempting to solve...")
                try:
                    # Import here to avoid dependency if not used
                    import cv2
                    import numpy as np
                    import requests
                    
                    # 1. Get Images
                    # We need to find the background and the slider block
                    # Selectors might vary, usually #slideBg and #slideBlock
                    
                    # Wait for images to load
                    try:
                        captcha_iframe.wait_for_selector('#slideBg', timeout=5000)
                    except:
                        logger.warning("⚠️ Captcha images not found (timeout)")
                    
                    # Get bounding box of the background to know the scale
                    bg_box = captcha_iframe.locator('#slideBg').bounding_box()
                    
                    # Get image sources (base64 or url)
                    bg_src = captcha_iframe.eval_on_selector('#slideBg', 'el => el.src')
                    block_src = captcha_iframe.eval_on_selector('#slideBlock', 'el => el.src')
                    
                    if bg_src and block_src:
                        logger.info("✅ Captcha images retrieved. Processing...")
                        # Helper to load image from url/base64
                        def load_image(src):
                            if src.startswith('data:image'):
                                import base64
                                encoded_data = src.split(',')[1]
                                nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
                            else:
                                resp = requests.get(src)
                                nparr = np.frombuffer(resp.content, np.uint8)
                            return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                        bg_img = load_image(bg_src)
                        block_img = load_image(block_src)
                        
                        # 2. Image Processing to find offset
                        # Convert to grayscale
                        bg_gray = cv2.cvtColor(bg_img, cv2.COLOR_BGR2GRAY)
                        block_gray = cv2.cvtColor(block_img, cv2.COLOR_BGR2GRAY)
                        
                        # Apply Canny Edge Detection
                        bg_edges = cv2.Canny(bg_gray, 100, 200)
                        block_edges = cv2.Canny(block_gray, 100, 200)
                        
                        # Match Template
                        result = cv2.matchTemplate(bg_edges, block_edges, cv2.TM_CCOEFF_NORMED)
                        _, _, _, max_loc = cv2.minMaxLoc(result)
                        target_x = max_loc[0]
                        
                        logger.info(f"🧩 Captcha Solution Found: Offset {target_x}")
                        
                        # 3. Calculate Drag Distance
                        # We need to scale the target_x based on the actual rendered size vs natural size
                        natural_width = bg_img.shape[1]
                        rendered_width = bg_box['width']
                        scale = rendered_width / natural_width
                        
                        final_x_offset = target_x * scale
                        
                        # 4. Perform Drag
                        # Find the slider knob (handle)
                        slider_knob = captcha_iframe.locator('.tcap-slide-btn') # Common class, might vary
                        if slider_knob.count() == 0:
                             slider_knob = captcha_iframe.locator('#tcap_slide_btn')
                        
                        if slider_knob.count() > 0:
                            box = slider_knob.bounding_box()
                            if box:
                                start_x = box['x'] + box['width'] / 2
                                start_y = box['y'] + box['height'] / 2
                                
                                # Move mouse to start
                                page.mouse.move(start_x, start_y)
                                page.mouse.down()
                                
                                # Move to target (Human-like movement could be better, but linear for now)
                                # We need to move relative to the iframe position? 
                                # Playwright handles coordinates globally usually.
                                
                                # Important: The offset is relative to the start position of the slider track?
                                # Usually we just move by final_x_offset pixels to the right
                                
                                # Let's move in steps
                                steps = 20
                                for i in range(steps):
                                    page.mouse.move(start_x + (final_x_offset * (i+1)/steps), start_y + (i % 2)) # slight y jitter
                                    time.sleep(0.05) # slow drag
                                
                                page.mouse.up()
                                logger.info("✅ Captcha Drag Completed")
                                time.sleep(3) # Wait for verification
                                
                    else:
                        logger.warning("⚠️ Could not get captcha image sources")
                                
                except Exception as e:
                    logger.error(f"❌ Failed to solve captcha: {e}")
                    # Don't return false yet, maybe it wasn't mandatory or we failed but can retry?
                    pass
            else:
                logger.info("ℹ️ No Captcha iframe found.")

            # ------------------------------------------------------------------
            # CAPTCHA HANDLING END
            # ------------------------------------------------------------------
            
            # Click Confirm
            logger.info("✅ Clicking Confirm...")
            page.evaluate("""() => {
                const elements = document.querySelectorAll('.Button_text__WeIeb');
                for (const el of elements) {
                    if (el.textContent && el.textContent.trim() === 'Confirm') {
                        const button = el.closest('.Button_btn__P0ibl');
                        if (button) button.click();
                    }
                }
            }""")
            
            time.sleep(5) # Increased delay to wait for result
            
            # Capture Screenshot for Verification
            import os
            if not os.path.exists("screenshots"):
                os.makedirs("screenshots")
            
            timestamp = int(time.time())
            screenshot_path = os.path.abspath(f"screenshots/result_{player_id}_{timestamp}.png")
            try:
                page.screenshot(path=screenshot_path)
                logger.info(f"📸 Screenshot saved: {screenshot_path}")
            except Exception as e:
                logger.error(f"⚠️ Failed to take screenshot: {e}")
                screenshot_path = None

            # Check Result - STRICTER CHECK
            # Use innerText to get only visible text, avoiding hidden "success" strings in scripts/metadata
            visible_text = page.evaluate("document.body.innerText").lower()
            
            # Log the visible text for debugging
            logger.info(f"📄 Page Text Content (First 500 chars): {visible_text[:500]}...")
            
            # Common Midasbuy success phrases
            success_keywords = [
                'redemption success', 
                'purchase success', 
                'transaction success', 
                'successfully redeemed',
                'redeemed successfully',
                'success' # Still keep simple 'success' but combined with visible text it's safer than HTML source
            ]
            
            # Specific error keywords
            error_keywords = [
                'redemption failed',
                'transaction failed',
                'invalid code',
                'system busy',
                'error',
                'wrong player id'
            ]
            
            is_success = False
            # Check for success
            for kw in success_keywords:
                if kw in visible_text:
                    is_success = True
                    break
            
            # Double check for error (Error takes precedence if both appear, though unlikely)
            for kw in error_keywords:
                if kw in visible_text:
                    is_success = False
                    break

            if is_success:
                logger.info("🎉 REDEMPTION SUCCESSFUL (Verified Visible Text)")
                return {"success": True, "message": "Top-up Successful!", "screenshot": screenshot_path}
            else:
                logger.error("❌ Redemption failed or unverified.")
                return {"success": False, "message": "Midasbuy: Redemption Failed or Unknown.", "screenshot": screenshot_path}

        except Exception as e:
            logger.error(f"Critical Error: {e}")
            return {"success": False, "message": f"System Error: {str(e)}"}
        finally:
            browser.close()
