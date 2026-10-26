# SignBoard OS สำหรับ Raspberry Pi 4

OS ที่สร้างจาก **Ubuntu Server 24.04 LTS (arm64)** ทำให้ Raspberry Pi 4 บูตแล้วเปิดหน้า Player ของ SignBoard เต็มจอทันที เหมาะกับต่อทีวีหรือจอโฆษณาผ่าน HDMI

สิ่งที่ได้หลังติดตั้ง:
- ล็อกอินอัตโนมัติ เปิด Chromium แบบ kiosk (ไม่มีแถบเมนู ไม่มีเมาส์ จอไม่ดับ)
- รอจนเชื่อมต่อเซิร์ฟเวอร์ได้ แล้วเปิด `/player` เอง ถ้า Chromium ปิดตัวจะเปิดใหม่อัตโนมัติ
- เก็บหน้า Player และไฟล์สื่อของเพลย์ลิสต์ไว้ในเครื่อง ไฟดับหรือเซิร์ฟเวอร์ล่มก็ยังเล่นต่อได้
- ฟอนต์ไทย, เขตเวลา Asia/Bangkok, รีบูตอัตโนมัติทุกวัน 04:00, หมุนจอได้
- SSH เข้าได้ด้วยผู้ใช้ `signage` (`ssh signage@signboard.local`)
- แก้ที่อยู่เซิร์ฟเวอร์ภายหลังได้จากไฟล์ `signboard.conf` บนการ์ด SD (เปิดจาก Windows/Mac ได้)

ต้องมี: Raspberry Pi 4 (RAM 2GB ขึ้นไป), การ์ด microSD 16GB ขึ้นไป, อินเทอร์เน็ตตอนบูตครั้งแรก

---

## วิธีที่ 1: ง่ายสุด (Windows / Mac ไม่ต้องรันสคริปต์)

1. เปิด **Raspberry Pi Imager** เลือก Raspberry Pi 4 → Other general-purpose OS → Ubuntu → **Ubuntu Server 24.04 LTS (64-bit)**
   - ตอนถามเรื่อง OS customisation ให้กด **No** (เราใช้ไฟล์ตั้งค่าของเราแทน)
2. หลังแฟลชเสร็จ ถอดแล้วเสียบการ์ดใหม่ จะเห็นไดรฟ์ชื่อ **system-boot**
3. คัดลอก 3 ไฟล์ในโฟลเดอร์ `boot-files/` ไปวางทับในไดรฟ์นั้น: `user-data`, `network-config`, `signboard.conf`
4. แก้ `signboard.conf` ให้ `SERVER_URL` เป็นที่อยู่เซิร์ฟเวอร์จริง เช่น `http://192.168.1.10:3000`
5. ถ้าใช้ Wi-Fi แก้ `network-config` เอา `#` ออกและใส่ชื่อ/รหัส Wi-Fi (ถ้าเสียบสาย LAN ไม่ต้องแก้)
6. เสียบการ์ดเข้า Pi ต่อจอและเน็ต แล้วเปิดเครื่อง

รหัสผ่านเริ่มต้นของผู้ใช้ `signage` คือ `signboard` ควรเปลี่ยนด้วย `passwd` หลัง SSH เข้าไปครั้งแรก

## วิธีที่ 2: สร้างไฟล์ image สำเร็จรูป (Linux หรือ WSL)

ใส่ค่าทุกอย่างลงใน image ไว้เลย แฟลชแล้วใช้ได้ทันที เหมาะกับการทำหลายเครื่อง

```bash
sudo apt install curl xz-utils python3 openssl mtools
./build-image.sh --server http://192.168.1.10:3000 \
  --wifi-ssid "ชื่อ WiFi" --wifi-pass "รหัส WiFi" \
  --password "รหัสผ่านใหม่" --hostname signboard-shop1
```

ได้ไฟล์ `signboard-pi4-YYYYMMDD.img.xz` แฟลชด้วย Raspberry Pi Imager (Use custom) หรือ balenaEtcher

ตัวเลือกอื่น: `--rotate left|right|inverted`, `--ssh-key ~/.ssh/id_ed25519.pub`, `--reboot-time 03:30` (ใส่ค่าว่างเพื่อปิด), `--timezone`, `--boot-files DIR` (สร้างแค่ 3 ไฟล์สำหรับวิธีที่ 1) ดูทั้งหมดด้วย `./build-image.sh --help`

---

## บูตครั้งแรก

ครั้งแรกเครื่องจะติดตั้งระบบเอง ใช้เวลาประมาณ **10–15 นาที** (ขึ้นกับความเร็วเน็ต) แล้วรีบูต 1 รอบ จากนั้นจอจะขึ้นรหัสจับคู่ 6 ตัว ให้ไปกรอกในหน้าจัดการ เมนู “จอแสดงผล” → “เพิ่มจอ”

## เปลี่ยนการตั้งค่าภายหลัง

ถอดการ์ดมาแก้ `signboard.conf` บนไดรฟ์ system-boot หรือ SSH เข้าไปแก้ `/boot/firmware/signboard.conf` แล้วรีบูต

| ค่า | ความหมาย |
|---|---|
| `SERVER_URL` | ที่อยู่เซิร์ฟเวอร์ SignBoard |
| `ROTATE` | `normal`, `left`, `right`, `inverted` |

## แก้ปัญหา

- **จอค้างที่ “กำลังเชื่อมต่อเซิร์ฟเวอร์”**: ตรวจว่า Pi กับเซิร์ฟเวอร์อยู่วงแลนเดียวกัน และเปิด `SERVER_URL` จากคอมเครื่องอื่นได้
- **ดู log การติดตั้งครั้งแรก**: `ssh signage@signboard.local` แล้ว `sudo cat /var/log/cloud-init-output.log`
- **รีสตาร์ตหน้าจอโดยไม่รีบูต**: `pkill chromium` (จะเปิดใหม่เองใน 3 วินาที)
- **วิดีโอกระตุก**: Pi 4 เล่น H.264 1080p ได้ดีที่สุด แนะนำแปลงไฟล์เป็น 1080p H.264 ก่อนอัปโหลด หลีกเลี่ยง 4K/HEVC

## ไฟล์ในโฟลเดอร์นี้

```
build-image.sh          สร้าง image หรือไฟล์ตั้งค่า
boot-files/             ไฟล์สำเร็จรูปสำหรับวิธีที่ 1
files/signboard-kiosk   สคริปต์เปิด Chromium แบบ kiosk (ถูกฝังเข้า user-data ตอน build)
files/boot.html         หน้ารอเชื่อมต่อเซิร์ฟเวอร์
```

ถ้าแก้ไฟล์ใน `files/` ให้รัน `./build-image.sh --server ... --boot-files boot-files` ใหม่เพื่ออัปเดต `boot-files/`
