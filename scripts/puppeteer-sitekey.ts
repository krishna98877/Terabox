/**
 * Extract reCAPTCHA sitekey using Puppeteer (loads the actual page)
 * This is the ONLY reliable way to get TeraBox's current sitekey
 */
async function main() {
  try {
    const puppeteer = await import('puppeteer');
    console.log('Launching browser...');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Go to TeraBox main page
    console.log('Navigating to TeraBox...');
    await page.goto('https://www.1024terabox.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('Page loaded');
    
    // Try to find the signup/register button and click it to open the signup modal
    console.log('Looking for signup trigger...');
    
    // First, let's check what's on the page
    const pageContent = await page.content();
    console.log(`Page HTML length: ${pageContent.length}`);
    
    // Search for recaptcha in the loaded page
    const sitekeyFromPage = await page.evaluate(() => {
      // Check for grecaptcha.render calls
      const scripts = document.querySelectorAll('script');
      const allScriptText = Array.from(scripts).map(s => s.textContent || '').join('\n');
      
      // Check iframe (reCAPTCHA creates an iframe)
      const iframes = document.querySelectorAll('iframe');
      const iframeSrcs = Array.from(iframes).map(f => f.src);
      
      return {
        scriptCount: scripts.length,
        iframeCount: iframes.length,
        iframeSrcs,
        hasGrecaptcha: typeof (window as any).grecaptcha !== 'undefined',
        recaptchaInScripts: allScriptText.includes('recaptcha'),
      };
    });
    
    console.log('Page state:', JSON.stringify(sitekeyFromPage, null, 2));
    
    // Try clicking sign up button
    try {
      // Look for sign up / register button
      const signUpSelectors = [
        'a[href*="register"]',
        'a[href*="signup"]', 
        'button:has-text("Sign Up")',
        '.register-btn',
        '[data-testid*="sign"]',
      ];
      
      // Just try to find and click any signup-like element
      const clicked = await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
          const text = link.textContent?.toLowerCase() || '';
          const href = link.href?.toLowerCase() || '';
          if (text.includes('sign up') || text.includes('register') || href.includes('register')) {
            (link as HTMLElement).click();
            return { clicked: true, text: link.textContent, href: link.href };
          }
        }
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const btn of btns) {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('sign up') || text.includes('register') || text.includes('create')) {
            (btn as HTMLElement).click();
            return { clicked: true, text: btn.textContent };
          }
        }
        return { clicked: false };
      });
      
      console.log('Click result:', JSON.stringify(clicked));
      
      if (clicked.clicked) {
        // Wait for modal/page to load
        await new Promise(r => setTimeout(r, 3000));
        
        // Now look for reCAPTCHA
        const afterClick = await page.evaluate(() => {
          const iframes = document.querySelectorAll('iframe');
          const iframeSrcs = Array.from(iframes).map(f => f.src).filter(s => s.includes('recaptcha'));
          
          // Check for grecaptcha objects
          const grecaptcha = (window as any).grecaptcha;
          
          return {
            iframeSrcs,
            hasGrecaptcha: !!grecaptcha,
            grecaptchaKeys: grecaptcha ? Object.keys(grecaptcha) : [],
          };
        });
        
        console.log('After click:', JSON.stringify(afterClick, null, 2));
      }
    } catch (e: any) {
      console.log('Click error:', e.message);
    }
    
    // Listen for network requests that might contain sitekey
    console.log('\nListening for recaptcha-related network requests...');
    const requests: string[] = [];
    page.on('request', req => {
      if (req.url().includes('recaptcha') || req.url().includes('captcha')) {
        requests.push(req.url());
      }
    });
    
    // Reload and wait
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    
    console.log(`Captcha-related requests: ${requests.length}`);
    for (const r of requests) {
      console.log(`  ${r.substring(0, 150)}`);
      // Extract sitekey from URL params
      const match = r.match(/[?&]k=([^&]+)/);
      if (match) {
        console.log(`  ★★★ SITEKEY from URL: ${match[1]}`);
      }
    }
    
    await browser.close();
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

main().catch(console.error);
