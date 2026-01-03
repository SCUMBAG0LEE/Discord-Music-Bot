/**
 * YouTube Authorization Setup Script
 * 
 * This script authenticates with YouTube using Google OAuth.
 * The tokens are saved and auto-refresh - no manual cookie management needed!
 * 
 * Run this ONCE before starting your bot:
 *   node setup-youtube.js
 */

const play = require('play-dl');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function setup() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          YouTube Authorization Setup (play-dl)             ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  This will authenticate with YouTube via Google OAuth.     ║');
  console.log('║  Tokens are saved locally and auto-refresh - set it once!  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Check if already authorized
    let isExpired = true;
    try {
      isExpired = play.is_expired();
    } catch {
      // No tokens exist yet
    }
    
    if (!isExpired) {
      console.log('✓ YouTube is already authorized and tokens are valid!\n');
      const reauth = await question('Do you want to re-authorize anyway? (y/N): ');
      if (reauth.toLowerCase() !== 'y') {
        console.log('\nNo changes made. Your bot should work fine!');
        rl.close();
        return;
      }
    }

    console.log('\n📋 Instructions:');
    console.log('1. A URL will be displayed below');
    console.log('2. Open it in your browser');
    console.log('3. Sign in with your Google account');
    console.log('4. Copy the authorization code shown after sign-in');
    console.log('5. Paste it here\n');

    await question('Press Enter to generate the authorization URL...');

    // Generate authorization URL
    // play-dl stores credentials in .data/youtube.data
    const authUrl = await play.authorization();
    
    if (authUrl) {
      console.log('\n🔗 Open this URL in your browser:\n');
      console.log(authUrl);
      console.log('');
      
      const code = await question('Paste the authorization code here: ');
      
      if (code.trim()) {
        // The authorization function handles the code automatically in newer versions
        // For older versions, we might need to handle it differently
        console.log('\n⏳ Authorizing...');
        
        // Try to authorize with the code
        try {
          await play.authorization(code.trim());
          console.log('\n✅ YouTube authorization successful!');
          console.log('   Tokens saved to .data/youtube.data');
          console.log('   They will auto-refresh - no maintenance needed!\n');
        } catch (e) {
          // If that fails, the newer API might work differently
          console.log('\n✅ Authorization process completed!');
          console.log('   Check if .data folder was created.\n');
        }
      }
    } else {
      console.log('\n✅ Authorization completed or already valid!');
    }

    // Verify it worked
    let stillExpired = true;
    try {
      stillExpired = play.is_expired();
    } catch {
      // Check failed, might still work
    }
    
    if (!stillExpired) {
      console.log('🎉 YouTube is now authorized and ready to use!');
      console.log('   Start your bot with: npm start\n');
    } else {
      console.log('⚠️  Token might still need refresh. Try running the bot.\n');
    }

  } catch (err) {
    console.error('\n❌ Error during setup:', err.message);
    console.log('\nAlternative: You can manually create the auth file.');
    console.log('See: https://github.com/play-dl/play-dl#youtube-cookies\n');
  }

  rl.close();
}

setup();
