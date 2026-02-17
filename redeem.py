import json
import time
import os
import pickle
import platform
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException, ElementNotInteractableException
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service

class MidasbuyRedeemer:
    """
    Complete Midasbuy PUBG Mobile Code Redeemer
    Uses standard Selenium with automatic ChromeDriver management
    """
    
    def __init__(self, headless=False, proxy=None):
        self.driver = None
        self.headless = headless
        self.proxy = proxy
        self.cookie_file = 'midasbuy_cookies.pkl'
        self.wait_timeout = 20
        
    def setup_driver(self):
        """
        Setup Chrome driver with automatic driver management
        """
        print("🔧 Setting up Chrome driver...")
        
        options = webdriver.ChromeOptions()
        
        # Anti-detection arguments
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option('useAutomationExtension', False)
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--window-size=1920,1080')
        options.add_argument('--start-maximized')
        options.add_argument('--disable-gpu')
        options.add_argument('--disable-web-security')
        options.add_argument('--allow-running-insecure-content')
        
        # Set user agent
        options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        
        # Disable images for faster loading
        prefs = {"profile.managed_default_content_settings.images": 2}
        options.add_experimental_option("prefs", prefs)
        
        # Add proxy if specified
        if self.proxy:
            options.add_argument(f'--proxy-server={self.proxy}')
            print(f"🔄 Using proxy: {self.proxy}")
        
        # Headless mode
        if self.headless:
            options.add_argument('--headless=new')
            print("👻 Running in headless mode")
        
        try:
            # Automatically download and use correct ChromeDriver version
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=options)
            
            # Execute anti-detection script
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            
            print("✅ Chrome driver setup complete")
            return self.driver
            
        except Exception as e:
            print(f"❌ Error setting up driver: {e}")
            raise
    
    def save_cookies(self):
        """Save cookies to file"""
        if self.driver:
            cookies = self.driver.get_cookies()
            with open(self.cookie_file, 'wb') as f:
                pickle.dump(cookies, f)
            print(f"✅ Saved {len(cookies)} cookies to {self.cookie_file}")
            
            # Also save as JSON for inspection
            with open('midasbuy_cookies.json', 'w') as f:
                json.dump(cookies, f, indent=2)
    
    def load_cookies(self):
        """Load cookies from file"""
        if os.path.exists(self.cookie_file):
            with open(self.cookie_file, 'rb') as f:
                return pickle.load(f)
        return None
    
    def inject_cookies(self):
        """
        Inject saved cookies into the current session
        """
        cookies = self.load_cookies()
        if not cookies:
            return False
        
        # Navigate to domain first
        self.driver.get("https://www.midasbuy.com")
        time.sleep(2)
        
        # Add each cookie
        for cookie in cookies:
            try:
                # Convert expiry if needed
                if 'expiry' in cookie:
                    cookie['expiry'] = int(cookie['expiry'])
                self.driver.add_cookie(cookie)
            except Exception as e:
                print(f"⚠️ Could not add cookie {cookie.get('name', 'unknown')}: {str(e)[:50]}")
        
        self.driver.refresh()
        time.sleep(3)
        return True
    
    def wait_for_element(self, by, selector, timeout=None, condition="presence"):
        """
        Wait for element with various conditions
        """
        if timeout is None:
            timeout = self.wait_timeout
            
        try:
            if condition == "clickable":
                element = WebDriverWait(self.driver, timeout).until(
                    EC.element_to_be_clickable((by, selector))
                )
            elif condition == "visible":
                element = WebDriverWait(self.driver, timeout).until(
                    EC.visibility_of_element_located((by, selector))
                )
            else:
                element = WebDriverWait(self.driver, timeout).until(
                    EC.presence_of_element_located((by, selector))
                )
            return element
        except TimeoutException:
            return None
    
    def handle_promotional_popup(self):
        """
        Detect and close promotional popups/iframes
        """
        print("🛡️ Checking for promotional popups...")
        
        try:
            removed = self.driver.execute_script("""
                // Target the specific iframe wrapper
                const pagedoo = document.querySelector('.activity-iframe-wrapper.pagedoo-pc.open');
                if (pagedoo) {
                    pagedoo.remove();
                    return 'Pagedoo iframe wrapper removed';
                }
                
                // Generic pagedoo iframe
                const iframe = document.querySelector('iframe[src*="act/pagedoo"]');
                if (iframe) {
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
            """)
            
            if removed:
                print(f"✅ Popup handled: {removed}")
                time.sleep(0.5)
                return True
        except Exception as e:
            print(f"⚠️ Error checking popup: {e}")
        
        return False
    
    def clear_and_enter_player_id(self, player_id):
        """
        Clear existing Player ID and enter new one
        """
        print(f"\n🔄 Changing Player ID to: {player_id}")
        
        # Check for popup before starting
        self.handle_promotional_popup()
        
        try:
            # STEP 1: Click the switch icon to open player ID popup
            print("1. Opening Player ID popup...")
            
            # Try multiple selectors for switch icon
            switch_selectors = [
                (By.CSS_SELECTOR, '.UserDataBox_switch_btn__q0ZYA'),
                (By.CSS_SELECTOR, '[class*="switch_btn"]'),
                (By.XPATH, "//*[contains(@class, 'switch_btn')]")
            ]
            
            switch_clicked = False
            for by, selector in switch_selectors:
                try:
                    switch_btn = self.wait_for_element(by, selector, timeout=5, condition="clickable")
                    if switch_btn:
                        switch_btn.click()
                        switch_clicked = True
                        print("  ✓ Switch icon clicked")
                        break
                except:
                    continue
            
            if not switch_clicked:
                # Try JavaScript click
                switch_clicked = self.driver.execute_script("""
                    let switchIcon = document.querySelector('.UserDataBox_switch_btn__q0ZYA') || 
                                    document.querySelector('[class*="switch_btn"]');
                    if (switchIcon) {
                        switchIcon.click();
                        return true;
                    }
                    return false;
                """)
                
                if switch_clicked:
                    print("  ✓ Switch icon clicked via JavaScript")
            
            if not switch_clicked:
                print("❌ Could not find switch icon")
                return False
            
            print("⏳ Waiting for popup...")
            time.sleep(1)
            
            # STEP 2: Find Player ID input field
            print("2. Finding Player ID input...")
            
            input_selectors = [
                (By.CSS_SELECTOR, 'input[maxlength="30"][type="text"][placeholder="Enter Player ID"]'),
                (By.CSS_SELECTOR, '.SelectServerBox_input_wrap_box__qq+Iq input'),
                (By.CSS_SELECTOR, '.BindLoginPop_pop_mess__8gYyc input[type="text"]'),
                (By.XPATH, "//input[contains(@placeholder, 'Enter Player ID')]"),
                (By.XPATH, "//input[contains(@placeholder, 'Player ID')]")
            ]
            
            input_field = None
            for by, selector in input_selectors:
                input_field = self.wait_for_element(by, selector, timeout=5)
                if input_field:
                    print(f"  ✓ Found input field")
                    break
            
            if not input_field:
                print("❌ Could not find Player ID input field")
                return False
            
            # STEP 3: Clear existing value
            print("3. Clearing existing Player ID...")
            input_field.click()
            time.sleep(0.3)
            input_field.send_keys(Keys.CONTROL + 'a')
            time.sleep(0.2)
            input_field.send_keys(Keys.DELETE)
            time.sleep(0.3)
            
            # Verify cleared
            current_value = input_field.get_attribute('value')
            print(f"  ✓ Input cleared: '{current_value}'")
            
            # STEP 4: Enter new Player ID
            print(f"4. Entering new Player ID: {player_id}")
            input_field.send_keys(player_id)
            time.sleep(0.5)
            
            # Verify entered
            entered_value = input_field.get_attribute('value')
            print(f"  ✓ Entered: '{entered_value}'")
            
            if entered_value != player_id:
                print(f"⚠️ Value mismatch, setting via JavaScript")
                self.driver.execute_script("arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event('input'));", 
                                         input_field, player_id)
                time.sleep(0.3)
            
            # STEP 5: Click OK button
            print("5. Clicking OK button...")
            
            ok_selectors = [
                (By.CSS_SELECTOR, '.BindLoginPop_btn_wrap__eiPwz .Button_btn__P0ibl'),
                (By.XPATH, "//button[contains(text(), 'OK')]"),
                (By.XPATH, "//div[contains(@class, 'Button_text') and text()='OK']/parent::button")
            ]
            
            ok_clicked = False
            for by, selector in ok_selectors:
                try:
                    ok_btn = self.wait_for_element(by, selector, timeout=5, condition="clickable")
                    if ok_btn:
                        ok_btn.click()
                        ok_clicked = True
                        print("  ✓ OK button clicked")
                        break
                except:
                    continue
            
            if not ok_clicked:
                # Try JavaScript
                ok_clicked = self.driver.execute_script("""
                    const popup = document.querySelector('.BindLoginPop_pop_mess__8gYyc');
                    if (!popup) return false;
                    
                    const buttons = document.querySelectorAll('.Button_text__WeIeb');
                    for (const btn of buttons) {
                        if (btn.textContent && btn.textContent.trim() === 'OK') {
                            if (popup.contains(btn)) {
                                const button = btn.closest('.Button_btn__P0ibl');
                                if (button) {
                                    button.click();
                                    return true;
                                }
                            }
                        }
                    }
                    return false;
                """)
                
                if ok_clicked:
                    print("  ✓ OK button clicked via JavaScript")
            
            if not ok_clicked:
                print("❌ Could not click OK button")
                return False
            
            # Wait for update
            print("6. Waiting for update...")
            time.sleep(1)
            
            # Verify
            current_display = self.driver.execute_script("""
                const idElement = document.querySelector('.UserDataBox_sub_text__laXQu');
                return idElement ? idElement.textContent : '';
            """)
            
            if player_id in current_display:
                print(f"✅ Successfully changed to Player ID: {player_id}")
                return True
            else:
                print(f"⚠️ Could not verify change: {current_display}")
                return False
            
        except Exception as e:
            print(f"❌ Error changing Player ID: {e}")
            return False
    
    def enter_redeem_code(self, code):
        """
        Enter redeem code into the input field
        """
        print(f"\n⌨️ Entering redeem code: {code}")
        
        try:
            # Find code input field
            code_selectors = [
                (By.CSS_SELECTOR, '.Input_input__s4ezt input[type="text"]'),
                (By.XPATH, "//input[contains(@placeholder, 'code')]"),
                (By.XPATH, "//input[contains(@placeholder, 'PIN')]"),
                (By.CSS_SELECTOR, 'input[placeholder*="code"]')
            ]
            
            code_field = None
            for by, selector in code_selectors:
                code_field = self.wait_for_element(by, selector, timeout=10, condition="clickable")
                if code_field:
                    print("  ✓ Found code input field")
                    break
            
            if not code_field:
                print("❌ Could not find code input field")
                return False
            
            # Click and clear
            code_field.click()
            time.sleep(0.3)
            code_field.send_keys(Keys.CONTROL + 'a')
            time.sleep(0.2)
            code_field.send_keys(Keys.DELETE)
            time.sleep(0.3)
            
            # Enter code
            code_field.send_keys(code)
            time.sleep(0.5)
            
            print("✅ Code entered successfully")
            return True
            
        except Exception as e:
            print(f"❌ Error entering code: {e}")
            return False
    
    def complete_redemption(self):
        """
        Complete the redemption process
        """
        print("\n🔘 Completing redemption...")
        
        try:
            # Enable OK button if disabled
            self.driver.execute_script("""
                const button = document.querySelector('.RedeemStepBox_btn_wrap__wEKY9 .Button_btn__P0ibl');
                if (button && button.classList.contains('Button_disable__fVSbn')) {
                    button.classList.remove('Button_disable__fVSbn');
                    button.style.pointerEvents = 'auto';
                }
            """)
            time.sleep(0.3)
            
            # Click OK button
            ok_selectors = [
                (By.CSS_SELECTOR, '.RedeemStepBox_btn_wrap__wEKY9 .Button_btn__P0ibl'),
                (By.XPATH, "//button[contains(text(), 'OK')]"),
                (By.XPATH, "//div[contains(text(), 'OK')]/parent::button")
            ]
            
            ok_clicked = False
            for by, selector in ok_selectors:
                try:
                    ok_btn = self.wait_for_element(by, selector, timeout=5, condition="clickable")
                    if ok_btn:
                        ok_btn.click()
                        ok_clicked = True
                        print("  ✓ OK button clicked")
                        break
                except:
                    continue
            
            if not ok_clicked:
                # JavaScript click
                self.driver.execute_script("""
                    document.querySelector('.RedeemStepBox_btn_wrap__wEKY9 .Button_btn__P0ibl').click();
                """)
                print("  ✓ OK button clicked via JavaScript")
            
            time.sleep(1.5)
            
            # Click Confirm button
            confirm_selectors = [
                (By.XPATH, "//button[contains(text(), 'Confirm')]"),
                (By.XPATH, "//div[contains(text(), 'Confirm')]/parent::button"),
                (By.CSS_SELECTOR, '.Button_text__WeIeb')
            ]
            
            confirm_clicked = False
            for by, selector in confirm_selectors:
                try:
                    elements = self.driver.find_elements(by, selector)
                    for element in elements:
                        if element.text and 'Confirm' in element.text:
                            btn = element.find_element(By.XPATH, './ancestor::button')
                            if btn:
                                btn.click()
                                confirm_clicked = True
                                print("  ✓ Confirm button clicked")
                                break
                    if confirm_clicked:
                        break
                except:
                    continue
            
            if not confirm_clicked:
                # JavaScript
                self.driver.execute_script("""
                    const elements = document.querySelectorAll('.Button_text__WeIeb');
                    for (const el of elements) {
                        if (el.textContent && el.textContent.trim() === 'Confirm') {
                            const button = el.closest('.Button_btn__P0ibl');
                            if (button) {
                                button.click();
                                return true;
                            }
                        }
                    }
                """)
                print("  ✓ Confirm button clicked via JavaScript")
            
            time.sleep(2.5)
            
            # Check result
            page_source = self.driver.page_source.lower()
            
            if 'success' in page_source or '成功' in page_source:
                print("🎉 SUCCESS! Redemption successful!")
                return True
            elif 'error' in page_source or '失败' in page_source:
                print("❌ ERROR! Redemption failed.")
                return False
            else:
                print("⚠️ Result unclear. Check screenshot.")
                return False
            
        except Exception as e:
            print(f"❌ Error completing redemption: {e}")
            return False
    
    def manual_login_and_save_cookies(self):
        """
        First-time setup: manually log in and save cookies
        """
        print("\n🔐 FIRST-TIME COOKIE SETUP")
        print("=" * 50)
        
        try:
            self.setup_driver()
            
            # Navigate to Midasbuy
            print("🌐 Opening Midasbuy...")
            self.driver.get("https://www.midasbuy.com")
            
            print("\n" + "=" * 50)
            print("⚠️  IMPORTANT INSTRUCTIONS:")
            print("1. Log in to your Midasbuy account manually")
            print("2. Complete any CAPTCHA if prompted")
            print("3. Navigate to the redemption page if you want")
            print("=" * 50)
            
            input("\n⏸️ Press ENTER after you have successfully logged in...")
            
            # Get and save cookies
            self.save_cookies()
            
            print("\n✅ Cookie capture complete!")
            
        except Exception as e:
            print(f"❌ Error: {e}")
        finally:
            if self.driver:
                input("\nPress ENTER to close browser...")
                self.driver.quit()
    
    def redeem_code(self, code, player_id=None):
        """
        Main redemption function
        """
        print("\n" + "=" * 60)
        print("🎮 STARTING REDEMPTION")
        print("=" * 60)
        print(f"📱 Player ID: {player_id or 'Current'}")
        print(f"🎁 Code: {code}")
        
        try:
            # Setup driver
            self.setup_driver()
            
            # Load cookies
            if not self.load_cookies():
                print("❌ No cookies found. Please run option 1 first.")
                return False
            
            # Inject cookies
            print("\n🍪 Injecting cookies...")
            self.inject_cookies()
            
            # Navigate to redemption page
            print("🌐 Loading redemption page...")
            self.driver.get("https://www.midasbuy.com/midasbuy/ot/redeem/pubgm")
            time.sleep(3)
            
            # Handle popups
            self.handle_promotional_popup()
            
            # Change Player ID if requested
            if player_id:
                success = self.clear_and_enter_player_id(player_id)
                if not success:
                    print("⚠️ Player ID change may have failed, continuing anyway...")
            
            # Enter code
            if not self.enter_redeem_code(code):
                print("❌ Failed to enter code")
                return False
            
            # Complete redemption
            result = self.complete_redemption()
            
            # Take screenshot
            screenshot = f"redemption_{int(time.time())}.png"
            self.driver.save_screenshot(screenshot)
            print(f"📸 Screenshot saved: {screenshot}")
            
            return result
            
        except Exception as e:
            print(f"❌ Critical error: {e}")
            try:
                self.driver.save_screenshot(f"error_{int(time.time())}.png")
            except:
                pass
            return False
            
        finally:
            time.sleep(3)
            if self.driver:
                self.driver.quit()


def main():
    """
    Main function with menu interface
    """
    print("=" * 70)
    print("🎮 MIDASBUY PUBG MOBILE CODE REDEEMER")
    print("=" * 70)
    
    while True:
        print("\n" + "-" * 40)
        print("MAIN MENU:")
        print("-" * 40)
        print("1. First-time setup (capture cookies)")
        print("2. Redeem a single code")
        print("3. Batch redeem from CSV file")
        print("4. Test ChromeDriver")
        print("5. Exit")
        
        choice = input("\nEnter choice (1-5): ").strip()
        
        if choice == '1':
            redeemer = MidasbuyRedeemer(headless=False)
            redeemer.manual_login_and_save_cookies()
            
        elif choice == '2':
            code = input("Enter redemption code: ").strip()
            change_id = input("Change Player ID? (y/n): ").strip().lower()
            
            player_id = None
            if change_id == 'y':
                player_id = input("Enter NEW Player ID: ").strip()
            
            if code:
                redeemer = MidasbuyRedeemer(headless=False)
                result = redeemer.redeem_code(code, player_id)
                print(f"\n{'✅ SUCCESS' if result else '❌ FAILED'}")
            else:
                print("❌ Code is required")
            
        elif choice == '3':
            file_path = input("Enter path to CSV file (code,player_id): ").strip()
            
            try:
                import csv
                redemptions = []
                with open(file_path, 'r') as f:
                    reader = csv.reader(f)
                    header = next(reader)  # Skip header
                    for row in reader:
                        if len(row) >= 1:
                            redemptions.append({
                                'code': row[0].strip(),
                                'player_id': row[1].strip() if len(row) > 1 else None
                            })
                
                print(f"📋 Loaded {len(redemptions)} redemptions")
                
                redeemer = MidasbuyRedeemer(headless=True)
                results = []
                
                for i, item in enumerate(redemptions, 1):
                    print(f"\n--- Processing {i}/{len(redemptions)} ---")
                    result = redeemer.redeem_code(item['code'], item['player_id'])
                    results.append({
                        'code': item['code'],
                        'player_id': item['player_id'],
                        'success': result,
                        'timestamp': datetime.now().isoformat()
                    })
                    
                    # Save intermediate results
                    with open('batch_results.json', 'w') as f:
                        json.dump(results, f, indent=2)
                    
                    # Wait between redemptions
                    if i < len(redemptions):
                        wait = 10
                        print(f"⏱️ Waiting {wait} seconds...")
                        time.sleep(wait)
                
                print("\n✅ Batch processing complete!")
                print(f"Results saved to batch_results.json")
                
            except Exception as e:
                print(f"❌ Error: {e}")
            
        elif choice == '4':
            print("\n🔧 Testing ChromeDriver...")
            try:
                from webdriver_manager.chrome import ChromeDriverManager
                from selenium.webdriver.chrome.service import Service
                
                print("📦 Installing/updating ChromeDriver...")
                driver_path = ChromeDriverManager().install()
                print(f"✅ ChromeDriver path: {driver_path}")
                
                service = Service(driver_path)
                options = webdriver.ChromeOptions()
                options.add_argument('--headless=new')
                
                driver = webdriver.Chrome(service=service, options=options)
                print("✅ Chrome started successfully!")
                print(f"📊 Browser version: {driver.capabilities['browserVersion']}")
                driver.quit()
                
            except Exception as e:
                print(f"❌ Error: {e}")
            
        elif choice == '5':
            print("\nGoodbye! 👋")
            break
        
        else:
            print("❌ Invalid choice")


if __name__ == "__main__":
    main()