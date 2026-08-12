/**
 * Get the REAL reCAPTCHA sitekey from TeraBox signup form via Puppeteer
 */
async function main() {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Intercept network requests for recaptcha
  const recaptchaRequests: string[] = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('recaptcha')) {
      recaptchaRequests.push(url);
      console.log(`[Network] ${url.substring(0, 150)}`);
    }
  });

  console.log('Loading TeraBox...');
  await page.goto('https://www.1024terabox.com/', { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('Main page loaded');

  // Try to click the Login/Register button to open the auth modal
  console.log('Looking for login/signup buttons...');
  
  // Take screenshot of current page
  await page.screenshot({ path: '/home/z/my-project/download/terabox-main.png' });
  console.log('Screenshot saved');
  
  // Get all visible buttons and links
  const buttons = await page.evaluate(() => {
    const elements = document.querySelectorAll('a, button, [role="button"], [class*="btn"], [class*="login"], [class*="sign"]');
    return Array.from(elements).map(el => ({
      tag: el.tagName,
      text: (el.textContent || '').trim().substring(0, 50),
      href: (el as HTMLAnchorElement).href || '',
      className: el.className?.substring?.(0, 80) || '',
      id: el.id?.substring(0, 50) || '',
    })).filter(el => el.text || el.href);
  });
  
  console.log(`\nFound ${buttons.length} interactive elements:`);
  for (const b of buttons.slice(0, 30)) {
    console.log(`  ${b.tag} text="${b.text}" href="${b.href}" class="${b.className}"`);
  }
  
  // Try clicking login/signin
  for (const b of buttons) {
    const lower = (b.text + ' ' + b.href + ' ' + b.className).toLowerCase();
    if (lower.includes('login') || lower.includes('sign in') || lower.includes('log in')) {
      console.log(`\nClicking: ${b.text} (${b.tag})`);
      try {
        if (b.tag === 'A' && b.href) {
          await page.goto(b.href, { waitUntil: 'networkidle2', timeout: 20000 });
        } else {
          await page.click(`text="${b.text}"`);
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (e: any) {
        console.log(`Click error: ${e.message}`);
        // Try by selector
        try {
          await page.evaluate((text: string) => {
            const els = document.querySelectorAll('a, button');
            for (const el of els) {
              if (el.textContent?.trim().toLowerCase().includes(text.toLowerCase())) {
                (el as HTMLElement).click();
                return;
              }
            }
          }, b.text);
          await new Promise(r => setTimeout(r, 3000));
        } catch {}
      }
      break;
    }
  }
  
  await page.screenshot({ path: '/home/z/my-project/download/terabox-after-click.png' });
  console.log('\nAfter-click screenshot saved');
  
  // Check for signup/register link in the current page
  const signupLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    return Array.from(links).map(a => ({
      text: (a.textContent || '').trim(),
      href: a.href,
    })).filter(a => {
      const lower = (a.text + ' ' + a.href).toLowerCase();
      return lower.includes('register') || lower.includes('signup') || lower.includes('sign up') || lower.includes('create');
    });
  });
  
  console.log('\nSignup links found:', signupLinks.length);
  for (const l of signupLinks) {
    console.log(`  text="${l.text}" href="${l.href}"`);
    
    // Navigate to signup page
    if (l.href) {
      console.log('\nNavigating to signup page...');
      try {
        await page.goto(l.href, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 3000));
        
        // Check for recaptcha elements
        const rcInfo = await page.evaluate(() => {
          const iframes = document.querySelectorAll('iframe');
          const rcIframes = Array.from(iframes).filter(f => f.src.includes('recaptcha'));
          
          // Check for data-sitekey
          const widgets = document.querySelectorAll('[data-sitekey]');
          const sitekeys = Array.from(widgets).map(w => w.getAttribute('data-sitekey'));
          
          // Check for grecaptcha
          const hasGrecaptcha = typeof (window as any).grecaptcha !== 'undefined';
          
          return { rcIframes: rcIframes.length, iframeSrcs: rcIframes.map(f => f.src), sitekeys, hasGrecaptcha };
        });
        
        console.log('reCAPTCHA info:', JSON.stringify(rcInfo, null, 2));
        
        await page.screenshot({ path: '/home/z/my-project/download/terabox-signup.png' });
        console.log('Signup screenshot saved');
      } catch (e: any) {
        console.log(`Navigation error: ${e.message}`);
      }
      break;
    }
  }
  
  // Also check recaptcha network requests
  console.log(`\nTotal recaptcha network requests: ${recaptchaRequests.length}`);
  for (const r of recaptchaRequests) {
    console.log(`  ${r.substring(0, 200)}`);
    // Extract sitekey from anchor.js or fallback URL
    const kMatch = r.match(/[?&]k=([^&]+)/);
    if (kMatch) {
      console.log(`  ★★★ SITEKEY: ${kMatch[1]} ★★★`);
    }
  }
  
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
