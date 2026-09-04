# ফোনে ব্যবহার

1. `Document-Studio.apk` ফোনে নিয়ে খুলুন। Android চাইলে শুধু ওই browser/file manager-এর জন্য “Install unknown apps” অনুমতি দিন। পুরো ফোনের নিরাপত্তা বন্ধ করবেন না।
2. PC-তে Document Studio server চালু রাখুন। বাইরে থেকে ব্যবহার করতে ফোনে Tailscale চালু করে PC-র একই account/network-এ যুক্ত করুন।
3. অ্যাপ খুলে আগের username/password দিয়ে login করুন। API key নতুন করে দিতে হবে না—server-এ Save করা key ব্যবহৃত হবে।
4. Scan চাপলে Google ML Kit খুলবে। প্রথমবার module download-এর জন্য internet প্রয়োজন। Camera অথবা Gallery বেছে crop/filters দেখুন, তারপর Confirm করুন। ID-এর front এবং back আলাদা scan করুন।
5. Signature scan-এর পরে আগের server background সরিয়ে PNG preview দেখাবে। Passport photo ও AI processing-ও আগের server-এ হবে; ML Kit নিজে OCR/AI portrait করে না।
6. PDF Preview বাটনে PDF দেখা যাবে। Customer download এখন ZIP: একটি folder-এ সব ছবি, PDF ও details TXT থাকবে। Download-এ ফোনের কোথায় ফাইল রাখবেন বেছে নিন। ZIP extract করে Print PDF খুলুন। Print করতে Actual size / 100% ব্যবহার করুন।
7. Preview screen-এর Passport Photo Print Layout-এ ছবি drag করে বা Left/Top mm দিয়ে সরাতে পারবেন। তারপর Save করে নতুন ZIP download করুন। ZIP download ঠিক রাখতে APK version 1.1 install করুন।

Server বাটনে ঠিকানা বদলানো যায়। Default: `http://100.96.199.117:8765/` (Tailscale)। একই Wi-Fi-তে PC-র বর্তমান LAN ঠিকানা ব্যবহার করা যায়। PC বন্ধ থাকলে এই অ্যাপ কাজ করবে না; এটি আলাদা cloud hosting নয়।

Google Play Services-সহ Android 6 বা পরের ফোন ও অন্তত 1.7 GB RAM দরকার। এই APK পরীক্ষামূলক sideload build। বাস্তব ফোনে scanner পরীক্ষা করে তারপর নিয়মিত কাজ শুরু করুন।
