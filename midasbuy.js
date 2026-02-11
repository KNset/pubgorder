const playwright = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const pool = require('../config/database');

async function getCredentials() {
    const normalizeCookies = (c) => {
        if (!c) return [];
        if (Array.isArray(c)) return c;
        if (typeof c === 'string') {
            try {
                const parsed = JSON.parse(c);
                if (Array.isArray(parsed)) return parsed;
                if (parsed && typeof parsed === 'object') {
                    return Object.entries(parsed).map(([name, value]) => ({ name, value, domain: '.midasbuy.com' }));
                }
                return [];
            } catch (_) {
                return [];
            }
        }
        if (typeof c === 'object') {
            return Object.entries(c).map(([name, value]) => ({ name, value, domain: '.midasbuy.com' }));
        }
        return [];
    };

    try {
        const [rows] = await pool.execute("SELECT config FROM api_integrations WHERE api_type = 'midasbuy' AND is_active = true LIMIT 1");
        if (rows.length > 0) {
            const cfg = rows[0].config;
            const cookies = normalizeCookies(cfg?.cookies ?? cfg);
            if (cookies.length) return cookies;
        }
    } catch (e) {
        console.error('DB Config Error:', e.message);
    }

    try {
        const [rows2] = await pool.execute("SELECT config FROM api_credentials WHERE service = 'midasbuy' AND is_active = true LIMIT 1");
        if (rows2.length > 0) {
            const cfg2 = rows2[0].config;
            const cookies2 = normalizeCookies(cfg2?.cookies ?? cfg2);
            if (cookies2.length) return cookies2;
        }
    } catch (e2) {
        console.error('DB Fallback Error:', e2.message);
    }

    console.error('No Midasbuy credentials found in DB');
    return [];
}

async function handlePromotionalPopup(page) {
    /** Detect and close promotional popups/iframes */
    console.log("🛡️ Checking for promotional popups...");
    
    try {
        const removed = await page.evaluate(() => {
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
        });
        
        if (removed) {
            console.log(`✅ Popup handled: ${removed}`);
            // Wait a bit for DOM to settle
            await new Promise(r => setTimeout(r, 500));
            return true;
        }
    } catch (e) {
        console.log(`⚠️ Error checking popup: ${e.message}`);
    }
    return false;
}

async function clearAndEnterPlayerId(page, newPlayerId) {
    /** Clear existing Player ID and enter new one - EXACT SELECTOR */
    
    console.log(`\n🔄 Changing Player ID to: ${newPlayerId}`);
    
    // Check for popup before starting
    await handlePromotionalPopup(page);

    try {
        // STEP 0: Check if popup is ALREADY open
        const popupAlreadyOpen = await page.evaluate(() => {
            const input = document.querySelector('input[placeholder="Enter Player ID"]');
            return input && input.offsetParent !== null;
        });

        if (popupAlreadyOpen) {
            console.log("✅ Player ID popup is already open");
        } else {
            // STEP 1: Click the switch icon to open player ID popup
            console.log("1. Opening Player ID popup...");
            
            // Click the switch icon
            const switchClicked = await page.evaluate(() => {
                // Strategy 1: Original selector
                let switchIcon = document.querySelector('.UserDataBox_switch_btn__q0ZYA');
                
                // Strategy 2: Partial class match (safer for updates)
                if (!switchIcon) {
                    // Find any element with "switch_btn" in its class (using CSS selector is safer for SVGs)
                    switchIcon = document.querySelector('[class*="switch_btn"]');
                }

                // Strategy 3: Look for sibling of user info
                if (!switchIcon) {
                     const userInfo = document.querySelector('[class*="UserDataBox_text"]');
                     if (userInfo && userInfo.parentElement) {
                         // Try to find a sibling that looks like a button or icon
                         const siblings = userInfo.parentElement.children;
                         for (const sibling of siblings) {
                             if (sibling !== userInfo && !sibling.textContent) {
                                 // Assuming the icon has no text, or we can check other properties
                                 switchIcon = sibling;
                                 break;
                             }
                         }
                     }
                }

                if (switchIcon) {
                    switchIcon.click();
                    return true;
                }
                return false;
            });
            
            if (!switchClicked) {
                console.log("❌ Could not find switch icon");
                return false;
            }
            
            console.log("⏳ Waiting for popup...");
            await page.waitForTimeout(1000);
            
            // STEP 2: Check if popup opened
            const popupExists = await page.evaluate(() => {
                // Strategy 1: Specific class
                if (document.querySelector('.BindLoginPop_pop_mess__8gYyc')) return true;
                
                // Strategy 2: Look for the input field being visible
                const input = document.querySelector('input[placeholder="Enter Player ID"]');
                if (input && input.offsetParent !== null) return true;
                
                return false;
            });
            
            if (!popupExists) {
                console.log("❌ Player ID popup did not open");
                return false;
            }
            
            console.log("✅ Player ID popup opened");
        }
        
        // STEP 3: FOCUS AND CLEAR EXISTING PLAYER ID
        console.log("2. Clearing existing Player ID...");
        
        // METHOD 1: Direct click on the EXACT input field
        try {
            // Click the exact input field from your HTML
            await page.click('input[maxlength="30"][type="text"][placeholder="Enter Player ID"]', { timeout: 5000 });
            console.log("✅ Input field clicked");
        } catch (error) {
            console.log(`⚠️  Direct click failed: ${error.message}`);
            
            // METHOD 2: Alternative selector
            try {
                await page.click('.SelectServerBox_input_wrap_box__qq+Iq input', { timeout: 5000 });
                console.log("✅ Input field clicked (alternative)");
            } catch (error2) {
                console.log(`⚠️  Alternative click failed: ${error2.message}`);
                
                // METHOD 3: JavaScript focus
                const focused = await page.evaluate(() => {
                    const input = document.querySelector('input[maxlength="30"][type="text"][placeholder="Enter Player ID"]');
                    if (input) {
                        input.focus();
                        input.select();
                        return true;
                    }
                    return false;
                });
                
                if (focused) {
                    console.log("✅ Input focused via JavaScript");
                } else {
                    console.log("❌ Could not focus input");
                    return false;
                }
            }
        }
        
        await page.waitForTimeout(300);
        
        // Clear using keyboard (simulates user)
        console.log("3. Clearing with keyboard...");
        if (process.platform === 'darwin') {
            await page.keyboard.press('Meta+A');
        } else {
            await page.keyboard.press('Control+A');
        }
        await page.waitForTimeout(200);
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
        
        // Verify it's cleared
        const currentValue = await page.evaluate(() => {
            const input = document.querySelector('input[maxlength="30"][type="text"][placeholder="Enter Player ID"]');
            return input ? input.value : '';
        });
        
        console.log(`✅ Input cleared. Current value: '${currentValue}'`);
        
        // STEP 4: ENTER NEW PLAYER ID
        console.log(`4. Entering new Player ID: ${newPlayerId}`);
        
        // Type the new Player ID character by character
        for (const char of newPlayerId) {
            await page.keyboard.type(char);
            await page.waitForTimeout(40);
        }
        
        await page.waitForTimeout(600);
        
        // Verify new Player ID entered
        const enteredId = await page.evaluate(() => {
            const input = document.querySelector('input[maxlength="30"][type="text"][placeholder="Enter Player ID"]');
            return input ? input.value : '';
        });
        
        console.log(`✅ New Player ID entered: ${enteredId}`);
        
        if (enteredId !== newPlayerId) {
            console.log(`⚠️  Player ID mismatch. Expected: ${newPlayerId}, Got: ${enteredId}`);
            
            // Try to fix by setting directly
            await page.evaluate((id) => {
                const input = document.querySelector('input[maxlength="30"][type="text"][placeholder="Enter Player ID"]');
                if (input) {
                    input.value = id;
                    input.dispatchEvent(new Event('input'));
                    return input.value;
                }
                return '';
            }, newPlayerId);
            await page.waitForTimeout(300);
        }
        
        // STEP 5: CLICK OK TO CONFIRM
        console.log("5. Clicking OK to confirm...");
        
        // Check for popup again before clicking OK
        await handlePromotionalPopup(page);

        // Find the OK button in the popup
        const okButton = page.locator('.BindLoginPop_btn_wrap__eiPwz .Button_btn__P0ibl');
        const okButtonCount = await okButton.count();
        
        if (okButtonCount > 0) {
            await okButton.click();
            console.log("✅ OK button clicked");
        } else {
            // Alternative: Find by text
            const confirmClicked = await page.evaluate(() => {
                // Look for OK button in the popup
                const popup = document.querySelector('.BindLoginPop_pop_mess__8gYyc');
                if (!popup) return false;
                
                // Find all buttons with OK text
                const buttons = document.querySelectorAll('.Button_text__WeIeb');
                for (const btn of buttons) {
                    if (btn.textContent && btn.textContent.trim() === 'OK') {
                        // Check if it's in the popup
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
            });
            
            if (confirmClicked) {
                console.log("✅ OK button clicked (found by text)");
            } else {
                console.log("❌ Could not find OK button");
                return false;
            }
        }
        
        // Wait for change to take effect
        console.log("6. Waiting for Player ID to update...");
        await page.waitForTimeout(1000);
        
        // STEP 6: VERIFY PLAYER ID CHANGED
        console.log("7. Verifying Player ID changed...");
        
        const currentPlayer = await page.evaluate(() => {
            const playerElement = document.querySelector('.UserDataBox_text__PBFYE');
            const idElement = document.querySelector('.UserDataBox_sub_text__laXQu');
            
            return {
                name: playerElement ? playerElement.textContent : '',
                id: idElement ? idElement.textContent : ''
            };
        });
        
        console.log(`✅ Current Player: ${currentPlayer.name}`);
        console.log(`✅ Current Player ID display: ${currentPlayer.id}`);
        
        if (currentPlayer.id.includes(newPlayerId)) {
            console.log(`🎉 Successfully changed to Player ID: ${newPlayerId}`);
            return true;
        } else {
            console.log(`⚠️  Player ID display doesn't show new ID: ${currentPlayer.id} vs ${newPlayerId}`);
            console.log(`    ❌ FAILED: Player ID verification failed`);
            // Return false to indicate failure so we can alert the user
            return false; 
        }
        
    } catch (error) {
        console.log(`❌ Error changing Player ID: ${error.message}`);
        return false;
    }
}

async function enterRedeemCode(page, code) {
    /** Enter redeem code into the input field */
    
    console.log(`\n⌨️  Entering redeem code: ${code}`);
    
    try {
        // Click the input field to focus
        console.log("1. Focusing redeem code input...");
        await page.click('.Input_input__s4ezt input[type="text"]');
        await page.waitForTimeout(300);
        
        // Clear existing text
        console.log("2. Clearing input...");
        if (process.platform === 'darwin') {
            await page.keyboard.press('Meta+A');
        } else {
            await page.keyboard.press('Control+A');
        }
        await page.waitForTimeout(200);
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
        
        // Type code character by character
        console.log("3. Typing code...");
        for (const char of code) {
            await page.keyboard.type(char);
            await page.waitForTimeout(40);
        }
        
        await page.waitForTimeout(600);
        console.log("✅ Code entered");
        return true;
        
    } catch (error) {
        console.log(`❌ Error entering code: ${error.message}`);
        return false;
    }
}

async function completeRedemption(page, code) {
    /** Complete redemption process */
    
    try {
        // Enable OK button if disabled
        console.log("\n🔧 Checking OK button...");
        await page.evaluate(() => {
            const button = document.querySelector('.RedeemStepBox_btn_wrap__wEKY9 .Button_btn__P0ibl');
            if (button && button.classList.contains('Button_disable__fVSbn')) {
                button.classList.remove('Button_disable__fVSbn');
                button.style.pointerEvents = 'auto';
            }
            return true;
        });
        await page.waitForTimeout(300);
        
        // Click OK button
        console.log("🔘 Clicking OK...");
        const okClicked = await page.evaluate(() => {
            const button = document.querySelector('.RedeemStepBox_btn_wrap__wEKY9 .Button_btn__P0ibl');
            if (button) {
                button.click();
                return true;
            }
            return false;
        });
        
        if (!okClicked) {
            console.log("❌ Could not click OK");
            return false;
        }
        
        console.log("✅ OK clicked");
        await page.waitForTimeout(1500);
        
        // Click Confirm
        console.log("\n✅ Clicking Confirm...");
        await page.evaluate(() => {
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
            return false;
        });
        
        await page.waitForTimeout(2500);
        
        // Check result
        console.log("\n📋 Checking result...");
        const content = await page.content();
        const lowerContent = content.toLowerCase();
        
        if (lowerContent.includes('success') || lowerContent.includes('成功')) {
            console.log("🎉 SUCCESS! Redemption appears successful.");
            return true;
        } else if (lowerContent.includes('error') || lowerContent.includes('失败')) {
            console.log("❌ ERROR! Redemption failed.");
            return false;
        } else {
            console.log("⚠️  Result unclear. Check page manually.");
            return false;
        }
        
    } catch (error) {
        console.log(`❌ Error in redemption: ${error.message}`);
        return false;
    }
}

async function testPlayerIdInput() {
    /** Test the exact Player ID input selector */
    
    console.log("\n🔍 TESTING PLAYER ID INPUT SELECTOR");
    
    const cookies = await getCredentials();
    if (!cookies || cookies.length === 0) {
        console.log("❌ No cookies found");
        return false;
    }
    
    const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        locale: 'en-US',
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
    });
    const page = await context.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    
    try {
        // Setup
        await page.context().addCookies(cookies);
        await page.goto("https://www.midasbuy.com/midasbuy/mm/redeem/pubgm");
        await page.waitForTimeout(2500);
        
        // Click switch icon
        console.log("1. Clicking switch icon...");
        // Use robust selector logic here too
        await page.evaluate(() => {
            const btn = document.querySelector('.UserDataBox_switch_btn__q0ZYA') || 
                        document.querySelector('[class*="switch_btn"]');
            if (btn) btn.click();
        });
        await page.waitForTimeout(800);
        
        // Test selectors
        console.log("\n2. Testing selectors...");
        
        // Selector 1: Exact from HTML
        const selector1 = 'input[maxlength="30"][type="text"][placeholder="Enter Player ID"]';
        const count1 = await page.evaluate((sel) => {
            const elements = document.querySelectorAll(sel);
            return elements.length;
        }, selector1);
        console.log(`   Selector 1 '${selector1}': ${count1} elements`);
        
        // Selector 2: Container based
        const selector2 = '.SelectServerBox_input_wrap_box__qq+Iq input';
        const count2 = await page.evaluate((sel) => {
            const elements = document.querySelectorAll(sel);
            return elements.length;
        }, selector2);
        console.log(`   Selector 2 '${selector2}': ${count2} elements`);
        
        // Selector 3: Any input in popup
        const selector3 = '.BindLoginPop_pop_mess__8gYyc input[type="text"]';
        const count3 = await page.evaluate((sel) => {
            const elements = document.querySelectorAll(sel);
            return elements.length;
        }, selector3);
        console.log(`   Selector 3 '${selector3}': ${count3} elements`);
        
        // Try to click
        console.log("\n3. Trying to click input...");
        try {
            await page.click('input[maxlength="30"][type="text"][placeholder="Enter Player ID"]');
            console.log("✅ Click successful!");
            
            // Try to clear and enter test ID
            console.log("4. Testing clear and enter...");
            if (process.platform === 'darwin') {
                await page.keyboard.press('Meta+A');
            } else {
                await page.keyboard.press('Control+A');
            }
            await page.keyboard.press('Delete');
            await page.keyboard.type('123456789');
            await page.waitForTimeout(600);
            
            // Check value
            const value = await page.evaluate(() => {
                const input = document.querySelector('input[maxlength="30"][type="text"][placeholder="Enter Player ID"]');
                return input ? input.value : 'not found';
            });
            console.log(`✅ Value entered: ${value}`);
            
        } catch (error) {
            console.log(`❌ Click failed: ${error.message}`);
        }
        
        return true;
        
    } catch (error) {
        console.log(`Error: ${error.message}`);
        return false;
    } finally {
        await browser.close();
    }
}

async function mainRedemption(code, playerId = null) {
    /** Main redemption function - headless version */
    
    console.log(`\n🎮 Starting redemption...`);
    if (playerId) {
        console.log(`📱 Target Player ID: ${playerId}`);
    }
    console.log(`🎁 Redeem Code: ${code}`);
    
    // Load cookies
    const cookies = await getCredentials();
    if (!cookies || cookies.length === 0) {
        console.log("❌ No cookies found");
        return false;
    }
    
    // Fix cookies
    for (const cookie of cookies) {
        cookie.sameSite = 'Lax';
    }
    
    const browser = await playwright.chromium.launch({ 
        headless: true,
        proxy: { server: 'http://127.0.0.1:3128' }
    });
    const page = await browser.newPage();
    
    // Set timeouts
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);
    
    try {
        // Setup
        console.log("\n🍪 Adding cookies...");
        await page.context().addCookies(cookies);
        await page.waitForTimeout(1000);

        console.log("🌐 Loading page...");
        const targetUrls = [
            "https://www.midasbuy.com/midasbuy/mm/redeem/pubgm",
            "https://www.midasbuy.com/midasbuy/redeem/pubgm",
            "https://www.midasbuy.com/midasbuy/ot/redeem/pubgm"
        ];
        let loaded = false;
        for (const url of targetUrls) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
                // Use more robust selectors - match any class containing 'switch_btn' or the input field
                await page.waitForFunction(() => {
                    return document.querySelector('[class*="switch_btn"]') || 
                           document.querySelector('input[placeholder*="Player ID"]') ||
                           document.querySelector('.Input_input__s4ezt input[type="text"]');
                }, { timeout: 90000 });
                loaded = true;
                break;
            } catch (e) {
                console.log(`⚠️  Navigation failed for ${url}: ${e.message}`);
            }
        }
        if (!loaded) throw new Error('Failed to load Midasbuy redeem page');
        
        // Initial check for popups after load
        await handlePromotionalPopup(page);

        // Change Player ID if requested
        if (playerId) {
            console.log("\n" + "=".repeat(60));
            console.log("CHANGING PLAYER ID");
            console.log("=".repeat(60));
            const changeSuccess = await clearAndEnterPlayerId(page, playerId);
            
            if (!changeSuccess) {
                console.log("❌ Failed to change Player ID. Verifying current ID...");
                
                // Verify if current ID matches target ID
                const currentIdMatches = await page.evaluate((targetId) => {
                    const idElement = document.querySelector('.UserDataBox_sub_text__laXQu');
                    return idElement && idElement.textContent.includes(targetId);
                }, playerId);

                if (currentIdMatches) {
                    console.log("⚠️ Change failed, but current Player ID matches target. Proceeding.");
                } else {
                    throw new Error(`Failed to change Player ID to ${playerId} and current ID does not match.`);
                }
            }
        }
        
        // Enter redeem code
        console.log("\n" + "=".repeat(60));
        console.log("REDEEMING CODE");
        console.log("=".repeat(60));
        await enterRedeemCode(page, code);
        
        // Complete redemption
        const result = await completeRedemption(page, code);
        
        if (result) {
            console.log("\n✅ REDEMPTION SUCCESSFUL!");
        } else {
            console.log("\n❌ REDEMPTION FAILED");
        }
        
        return result;
        
    } catch (error) {
        console.log(`\n❌ Critical error: ${error.message}`);
        return false;
    } finally {
        console.log("\n✅ Process completed!");
        await browser.close();
    }
}

// ============== SIMPLE TERMINAL INTERFACE ==============
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

async function askQuestion(query) {
    return new Promise(resolve => {
        readline.question(query, answer => {
            resolve(answer);
        });
    });
}

async function main() {
    console.log("=".repeat(70));
    console.log("🎮 MIDASBUY AUTOMATED REDEMPTION (HEADLESS) - JavaScript");
    console.log("=".repeat(70));
    
    console.log("\nEnter redeem code:");
    const code = (await askQuestion("Code: ")).trim();
    
    console.log("\nDo you want to change Player ID? (y/n)");
    const changeId = (await askQuestion("Choice: ")).trim().toLowerCase();
    
    let playerId = null;
    if (changeId === 'y') {
        playerId = (await askQuestion("Enter NEW Player ID: ")).trim();
    }
    
    if (code) {
        await mainRedemption(code, playerId);
    } else {
        console.log("❌ Code is required");
    }
    
    readline.close();
}

// Run the program
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    clearAndEnterPlayerId,
    enterRedeemCode,
    completeRedemption,
    mainRedemption
};
