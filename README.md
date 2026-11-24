# C1 網頁控制器

在 Android 或電腦的 **Google Chrome** 開啟的網頁，透過 Web Bluetooth 連接 LiberLive C1：顯示演奏狀態，並送出控制指令。也可以把外接 MIDI 鍵盤或踏板對應到這些指令。

這**不是** LiberLive 官方產品，也沒有使用官方 SDK。協定整理自第三方專案 [orinayo-pico 的 `uni_bt_le.c`](https://github.com/Jus-Be/orinayo-pico/blob/master/bluepad32/bt/uni_bt_le.c)，屬於非官方解析，可能隨韌體改變而失效。

線上版本：https://hctsaik.github.io/c1-web-controller/

## 使用前請先看

1. 請先**完全關閉官方 LiberLive App**。C1 同時只能連一台裝置。
2. **不要**在手機的系統藍牙設定裡配對，請只用網頁上的「連線 C1」按鈕。
3. 請把這個分頁**保持在前景**。
4. iPhone / iPad 的 Safari **不支援** Web Bluetooth，請改用 Android 或電腦上的 Chrome。

## 用真實 C1 測試

1. 用 Android 的 Chrome 打開 https://hctsaik.github.io/c1-web-controller/
2. 關閉官方 LiberLive App，打開 C1 電源。
3. 點「連線 C1」，在系統視窗裡選名稱以 `Liber` 開頭的裝置（官方名稱是 LiberLive C1）。若清單是空的，再試「掃描全部裝置」。
4. 連上後，先看「除錯」區塊的 GATT 清單：
   - 來源記載的服務是 `000000ff-0000-1000-8000-00805f9b34fb`
   - 特徵是 `0000ff03-0000-1000-8000-00805f9b34fb`
   - 若對不上，請用清單上的「訂閱通知」「設為寫入目標」手動選。
5. 在琴上按和弦墊、撥撥片、改調或改速度，對照「演奏狀態」與「最新通知（原始十六進位）」是否合理。解析結果標有「非官方解析」。
6. 「寫入和弦對應」會送出來源在連線後實際寫入的 26 位元組，**可能會改到琴上的和弦配置**，請自行決定要不要送。
7. 「實驗性」按鈕只送出原始碼裡出現過、但被註解掉的封包。改欄位之後，送出的就不是來源裡那一組位元組。來源沒寫的內容，請用手動十六進位寫入。
8. 若要對 MIDI：接上鍵盤或踏板，點「啟用 MIDI」，選指令後按「開始學習」，再按下琴鍵、踏板或送出 Program Change。對應表存在這個瀏覽器的 localStorage。

若官方 App 能連、這個網頁不能連，可能是官方 App 仍占著連線，或瀏覽器不支援 Web Bluetooth。

## 沒有琴時預覽畫面

打開 https://hctsaik.github.io/c1-web-controller/?mock=1 會進入模擬模式，可用除錯區的「模擬通知」按鈕查看解析畫面。

## 本機開發

```bash
python3 -m http.server 8080
# 另開終端
npm test
```

單元測試只涵蓋解析與指令組裝，不需要實體裝置。Web Bluetooth 實際連線必須用真實的 C1 在 Chrome 裡驗證。

## 授權與來源

原始碼以 MIT 授權。LiberLive 是其權利人的商標。本專案與 Unknown Planet Technology Inc. / LiberLive 沒有關係。
