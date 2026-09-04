# Document Studio Chrome Extension

## Install (একবার)

1. Chrome-এর address bar-এ `chrome://extensions` লিখুন।
2. ডান পাশে **Developer mode** চালু করুন।
3. **Load unpacked** চাপুন।
4. Desktop-এর **Document Studio Extension** folder নির্বাচন করুন (ZIP নয়)।
5. Chrome toolbar-এর puzzle icon থেকে **Document Studio — Customer Search** Pin করুন।
6. Extension icon চাপলে side panel খুলবে। অন্য webpage বা tab-এ click করলে বন্ধ হবে না। বন্ধ করতে panel-এর **✕** চাপুন।

এটি Chrome-এর পাশে স্থায়ী panel; অন্য Windows app-এর ওপর floating/always-on-top window নয়। Chrome বন্ধ করলে বা Chrome-এর নিজস্ব Close দিয়ে বন্ধ করলে panel বন্ধ হবে। Chrome 141 বা নতুন version প্রয়োজন।

## ব্যবহার

- প্রথমবার আপনার Document Studio username/password দিয়ে login করুন। Login session server-এর cookie-তে থাকে; extension password সংরক্ষণ করে না। একই server address-এ browser login আগে থাকলে সেটি ব্যবহার হতে পারে।
- নাম, ফোন নম্বর, NID, email বা serial দিয়ে Search করুন। ফাইল খুললে Applicant আগে এবং Nominee পরে দেখাবে।
- Issue date/place যদি saved data-তে না থাকে, **দেওয়া নেই** দেখাবে; কোনো তথ্য অনুমান করা হয় না।
- Copy দিয়ে নির্দিষ্ট তথ্য copy করুন। ID ছবিগুলো খুলে দেখা যায়। Customer ZIP Download দিয়ে details TXT, ছবি ও PDF-সহ customer folder পাবেন।
- শুধু server-এ Save করা customer দেখা যাবে। সর্বোচ্চ ১০০টি result আসে; প্রয়োজন হলে আরও নির্দিষ্ট search করুন।
- মূল software-এর data change করলে আবার Search করে file খুলুন। Extension দিয়ে customer edit/delete করা হয় না।

## Server

সব অনুমোদিত PC-র জন্য default: `http://100.96.199.117:8765` (Tailscale)। পুরোনো localhost default এই version-এ স্বয়ংক্রিয়ভাবে পরিবর্তিত হবে।

অন্য PC-তে প্রথমে https://tailscale.com/download থেকে Tailscale install করে আপনার একই account/network-এ যুক্ত করুন। অন্য ব্যক্তিকে নিজের password দেবেন না; প্রয়োজনে Tailscale-এর device sharing/invite ব্যবহার করুন।

Tailscale connected হলে Chrome-এ `http://100.96.199.117:8765/` খুলে Document Studio login করুন। Extension download: `http://100.96.199.117:8765/Document-Studio-Chrome-Extension.zip`। ZIP extract করে সেই PC-তে Load unpacked করুন।

মূল PC-তে বিকল্প local ঠিকানা: `http://127.0.0.1:8765`। এই ব্যবস্থা public internet hosting নয়—Tailscale ছাড়া remote address খুলবে না।

Server settings-এ address বদলে **Save & Connect** করুন। নতুন server-এর জন্য Chrome permission চাইতে পারে। PC/server বন্ধ থাকলে search চলবে না। Public hosting-এর ক্ষেত্রে HTTPS ব্যবহার করুন; স্থানীয় port internet-এ খুলে দেবেন না।

Login বারবার চাইলে Chrome-এর site/cookie permission দেখুন; পুরো browser-এর cookie security বন্ধ করবেন না।

## Privacy

Customer data কেবল panel-এর memory-তে থাকে; extension storage-এ শুধু server address রাখা হয়। কোনো content script, browser history access, external analytics বা webpage autofill নেই। Clipboard-এ তথ্য শুধু Copy চাপলেই যায়। PDF download করলে ফাইলটি আপনার Chrome Downloads-এ থাকবে। Extension-এ API key নেই।

এটি unpacked local extension, Chrome Web Store-এ প্রকাশিত নয়। Folder মুছবেন না; ভবিষ্যৎ update-এ এই folder-এর files বদলে Chrome extensions page-এ Reload চাপুন।

Technical reference: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
