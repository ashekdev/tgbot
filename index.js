require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { 
  initializeApp 
} = require("firebase/app");
const { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  getDocs,
  collection,
  query,
  where,
  increment, 
  serverTimestamp,
  writeBatch
} = require("firebase/firestore");

// ---------------------------------------------------------
// 🔥 CONFIGURATION
// ---------------------------------------------------------

// Replace with your actual Firebase project config
const firebaseConfig = {
apiKey: "AIzaSyDeJS7fJhtZL0QKmbkEkwi829C11s1jEQQ",
            authDomain: "onlineincoembeta.firebaseapp.com",
            projectId: "onlineincoembeta",
            storageBucket: "onlineincoembeta.firebasestorage.app",
            messagingSenderId: "919654178637",
            appId: "1:919654178637:web:e35cb85e2680e05410e104",
            measurementId: "G-QDR0JDQ3CS",
            databaseURL: "https://onlineincoembeta-default-rtdb.firebaseio.com/"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Initialize Bot
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error("❌ BOT_TOKEN is missing in environment variables.");
    process.exit(1);
}
const bot = new TelegramBot(token, { polling: true });

// Constants
const REWARD_AMOUNT = 20; // 20 coins or whatever unit you use, example uses 20
const WELCOME_IMAGE = "https://i.postimg.cc/R0pYzGgX/46455093-32b0-4713-858a-bdd647a3602a.jpg";

// ---------------------------------------------------------
// 🔥 EXPRESS SERVER (Keep Alive)
// ---------------------------------------------------------
const server = express();
const PORT = process.env.PORT || 3000;

server.get('/', (req, res) => {
  res.send('🤖 Bot Backend is Running...');
});

server.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});

// ---------------------------------------------------------
// 🔥 HELPER FUNCTIONS
// ---------------------------------------------------------

/**
 * Helper to extract profile photo URL
 */
async function getUserProfilePhotoUrl(userId) {
    try {
        const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
        if (photos && photos.total_count > 0) {
            const fileId = photos.photos[0][0].file_id;
            const file = await bot.getFile(fileId);
            return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        }
    } catch (error) {
        console.error("Error fetching profile photo:", error.message);
    }
    return "https://i.postimg.cc/0jmM235X/user-placeholder.png"; // Fallback
}

/**
 * Create or Update User on /start
 */
async function createOrEnsureUser(userId, firstName, photoURL, referralId) {
    const userRef = doc(db, "users", userId.toString());
    
    // Check if user exists to avoid overwriting existing data blindly
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        const userData = {
            id: userId,
            name: firstName,
            photoURL: photoURL,
            coins: 0,
            reffer: 0,
            refferBy: referralId && referralId !== userId.toString() ? referralId : null,
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false,
            rewardGiven: false
        };
        
        // Create new user
        await setDoc(userRef, userData);
        console.log(`✅ New User Created: ${userId} (Ref: ${userData.refferBy})`);
    } else {
        // Update basic info (name/photo) but preserve balance/ref status
        await setDoc(userRef, {
            name: firstName,
            photoURL: photoURL
        }, { merge: true });
        console.log(`🔄 User Updated: ${userId}`);
    }
}

// ---------------------------------------------------------
// 🔥 BOT HANDLERS
// ---------------------------------------------------------

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || "User";
    
    // Extract referral param (e.g., /start ref123 -> "ref123" -> clean to "123")
    // Assuming format is just /start 123 or /start ref123
    let referralId = match[1] ? match[1].trim() : null;
    
    // Clean "ref" prefix if present
    if (referralId && referralId.startsWith("ref")) {
        referralId = referralId.replace("ref", "");
    }

    try {
        // 1. Get Photo
        const photoUrl = await getUserProfilePhotoUrl(userId);

        // 2. Database Operation
        await createOrEnsureUser(userId, firstName, photoUrl, referralId);

        // 3. Send Welcome Message
        const caption = `
👋 Hi! Welcome ${firstName} ⭐
❤️‍🩹 Online Income Beta তে আপনাকে স্বাগতম ❤️‍🩹
প্রতিদিন ৫০০ টাকার বেশি একদম ফ্রিতে ইনকাম করতে পারবেন আমাদের বট ব্যবহার করে। দেরি না করে এখন থেকেই শুরু করে দিন।
Start Earning Now 👇👇

🔥 Daily Tasks
🔥 Video Watch
🔥 Mini Apps
🔥 Referral Bonus
🔥 Auto Wallet System

Ready to earn?
Tap START and your journey begins!
        `;

        const opts = {
            caption: caption,
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "▶ Open App", web_app: { url: "https://watch.miniearningjob.top/" } }],
                    [{ text: "📢 Channel", url: "https://t.me/onlineincomebeta" }],
                    [{ text: "🌐 How To Work", url: "https://t.me/videochannelus/5" }]
                ]
            }
        };

        await bot.sendPhoto(chatId, WELCOME_IMAGE, opts);

    } catch (error) {
        console.error(`❌ Error in /start for ${userId}:`, error);
        bot.sendMessage(chatId, "An error occurred while setting up your account. Please try again.");
    }
});

// ---------------------------------------------------------
// 🔥 REFERRAL WORKER (Interval Based)
// ---------------------------------------------------------
// Checks for users who opened frontend but haven't given reward yet.

async function checkAndRewardReferrals() {
    try {
        // Query: frontendOpened == true AND rewardGiven == true
        const q = query(
            collection(db, "users"),
            where("frontendOpened", "==", true),
            where("rewardGiven", "==", false)
        );

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) return; // No pending rewards

        const batch = writeBatch(db);
        let operationsCount = 0;

        for (const userDoc of querySnapshot.docs) {
            const userData = userDoc.data();
            const userId = userData.id;
            const referrerId = userData.refferBy;

            // Condition: Must have a referrer to give reward
            if (referrerId) {
                const referrerRef = doc(db, "users", referrerId.toString());
                const userRef = doc(db, "users", userId.toString());
                const rewardRef = doc(db, "ref_rewards", userId.toString()); // Ledger ID is userId to prevent duplicates

                // 1. Increment Referrer stats
                batch.update(referrerRef, {
                    coins: increment(REWARD_AMOUNT),
                    reffer: increment(1)
                });

                // 2. Mark User as Reward Given
                batch.update(userRef, {
                    rewardGiven: true
                });

                // 3. Create Reward Ledger
                batch.set(rewardRef, {
                    userId: userId,
                    referrerId: referrerId,
                    reward: REWARD_AMOUNT,
                    createdAt: serverTimestamp()
                });

                console.log(`💰 Preparing Reward: ${referrerId} for referring ${userId}`);
                operationsCount++;
            } else {
                // If frontend opened but NO referrer, just mark rewardGiven true so we don't query them again
                const userRef = doc(db, "users", userId.toString());
                batch.update(userRef, { rewardGiven: true });
                operationsCount++;
            }
        }

        if (operationsCount > 0) {
            await batch.commit();
            console.log(`✅ Successfully processed ${operationsCount} referral rewards.`);
        }

    } catch (error) {
        console.error("❌ Error in Referral Worker:", error);
    }
}

// Run Worker Every 30 Seconds (Adjust time as needed to save quota/resources)
// Validating prompt req: "check all users... then reward them"
setInterval(() => {
    checkAndRewardReferrals();
}, 30000); // 30s is safer than 20ms for Firestore quotas.
