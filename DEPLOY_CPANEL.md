# 🚀 Hướng Dẫn Deploy RFID System lên cPanel

## Yêu cầu
- cPanel với Node.js App support (cPanel phiên bản 80+)
- Node.js phiên bản 14.x hoặc cao hơn
- MySQL database
- Git repository (GitHub, GitLab, hoặc Bitbucket)

---

## Phương Pháp 1: Deploy qua Git (Khuyến nghị)

### Bước 1: Push code lên Git Repository

```bash
# Khởi tạo git repository (nếu chưa có)
git init

# Add tất cả files
git add .

# Commit
git commit -m "Initial commit for cPanel deployment"

# Add remote repository (thay YOUR_REPO_URL bằng URL thực tế)
git remote add origin YOUR_REPO_URL

# Push lên GitHub/GitLab
git push -u origin main
```

### Bước 2: Cấu hình cPanel

1. **Đăng nhập vào cPanel**
2. **Tìm "Setup Node.js App"** trong cPanel
3. **Click "Create Application"**
4. **Điền thông tin:**
   - **Node.js version**: 18.x hoặc cao hơn
   - **Application mode**: Production
   - **Application root**: chọn thư mục (ví dụ: `rfid-nodejs`)
   - **Application URL**: domain hoặc subdomain của bạn
   - **Application startup file**: `app.js`
   - **Passenger log file**: để mặc định

### Bước 3: Deploy code từ Git

**Trong cPanel:**
1. Vào **"Git Version Control"**
2. Click **"Create"**
3. Điền thông tin:
   - **Clone URL**: URL repository của bạn
   - **Repository Path**: `/home/your_username/rfid-nodejs`
   - **Repository Name**: rfid-nodejs
4. Click **"Create"**

### Bước 4: Cài đặt dependencies

**Trong Terminal cPanel:**
```bash
cd ~/rfid-nodejs
npm install --production
```

### Bước 5: Cấu hình Environment Variables

**Tạo file `.env` trong thư mục dự án:**
```bash
nano .env
```

**Nội dung:**
```env
NODE_ENV=production
PORT=3000

# Database - Thay bằng thông tin thực tế
DB_HOST=localhost
DB_USER=your_cpanel_user
DB_PASSWORD=your_db_password
DB_NAME=your_cpanel_user_rfid

# Session Secret - Thay bằng chuỗi random
SESSION_SECRET=your_super_secret_key_change_this_123456

# RFID (nếu dùng)
RFID_PORT=/dev/ttyUSB0
RFID_BAUDRATE=9600

MAX_LOGIN_ATTEMPTS=5
SESSION_TIMEOUT=3600000
```

### Bước 6: Tạo Database

1. **Vào "MySQL Databases"** trong cPanel
2. **Tạo database mới**: `your_username_rfid`
3. **Tạo user và gán quyền** cho database
4. **Import database schema** (nếu có file .sql)

### Bước 7: Restart Node.js App

**Trong "Setup Node.js App":**
- Click vào ứng dụng của bạn
- Click nút **"Restart"**

---

## Phương Pháp 2: Upload trực tiếp qua File Manager

### Bước 1: Nén dự án

**Trên máy local:**
```bash
# Xóa node_modules trước khi nén
rm -rf node_modules

# Nén dự án (hoặc dùng WinRAR/7-Zip trên Windows)
zip -r rfid-nodejs.zip .
```

### Bước 2: Upload lên cPanel

1. **Vào "File Manager"** trong cPanel
2. **Chọn thư mục** (ví dụ: `public_html/rfid`)
3. **Upload file** `rfid-nodejs.zip`
4. **Giải nén** file zip

### Bước 3: Thiết lập Node.js App (giống Phương pháp 1)

Làm theo Bước 2-7 của Phương pháp 1

---

## Phương Pháp 3: Deploy qua FTP/SFTP

### Bước 1: Kết nối FTP

**Sử dụng FileZilla hoặc WinSCP:**
- **Host**: ftp.yourdomain.com
- **Username**: cPanel username
- **Password**: cPanel password
- **Port**: 21 (FTP) hoặc 22 (SFTP)

### Bước 2: Upload files

1. **Kết nối đến server**
2. **Chuyển đến thư mục** (ví dụ: `/home/username/rfid-nodejs`)
3. **Upload tất cả files** (trừ node_modules)

### Bước 3: Cài đặt và chạy (giống Phương pháp 1)

---

## ⚙️ Cấu hình Nâng cao

### 1. Sử dụng PM2 (nếu cPanel hỗ trợ)

```bash
# Cài PM2
npm install -g pm2

# Start app
pm2 start app.js --name rfid-system

# Lưu cấu hình
pm2 save

# Auto-start khi reboot
pm2 startup
```

### 2. Cấu hình Reverse Proxy (nếu cần)

**Trong .htaccess:**
```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ http://127.0.0.1:3000/$1 [P,L]
```

### 3. SSL Certificate

1. Vào **"SSL/TLS Status"** trong cPanel
2. Click **"Run AutoSSL"** để cài Let's Encrypt
3. Hoặc upload SSL certificate thủ công

---

## 🔍 Kiểm tra và Debug

### Xem logs

```bash
# Trong Terminal cPanel
cd ~/rfid-nodejs
tail -f logs/*.log

# Hoặc xem Passenger logs
tail -f ~/logs/*.log
```

### Test ứng dụng

```bash
# Kiểm tra app có chạy không
curl http://localhost:3000

# Hoặc truy cập qua domain
curl https://yourdomain.com
```

### Common Issues

**1. Port đã được sử dụng:**
- Đổi PORT trong .env (thường cPanel dùng app qua socket, không cần lo)

**2. Database connection failed:**
- Kiểm tra DB_HOST (thường là `localhost`)
- Kiểm tra username/password
- Kiểm tra user có quyền truy cập database

**3. Module not found:**
```bash
npm install
npm rebuild
```

---

## 📱 Auto Deploy (CI/CD)

### Tạo script auto-deploy

**Trong repository, tạo file `deploy.sh`:**
```bash
#!/bin/bash
cd ~/rfid-nodejs
git pull origin main
npm install --production
pm2 restart rfid-system
```

**Trong GitHub Actions (.github/workflows/deploy.yml):**
```yaml
name: Deploy to cPanel

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.CPANEL_HOST }}
          username: ${{ secrets.CPANEL_USER }}
          password: ${{ secrets.CPANEL_PASSWORD }}
          script: |
            cd ~/rfid-nodejs
            git pull origin main
            npm install --production
            pm2 restart rfid-system
```

---

## ✅ Checklist Hoàn thành

- [ ] Code đã được push lên Git repository
- [ ] Database đã được tạo trong cPanel
- [ ] File .env đã được cấu hình đúng
- [ ] Node.js App đã được tạo trong cPanel
- [ ] Dependencies đã được cài đặt (npm install)
- [ ] App đã được restart và chạy thành công
- [ ] SSL đã được cài đặt (nếu cần)
- [ ] Domain/subdomain đã được cấu hình đúng
- [ ] Logs không có lỗi nghiêm trọng

---

## 📞 Hỗ trợ

Nếu gặp vấn đề, kiểm tra:
1. Node.js logs: `~/logs/*.log`
2. Application logs: `~/rfid-nodejs/logs/*.log`
3. cPanel error logs

**Liên hệ hosting provider** nếu cần hỗ trợ cấu hình Node.js App.
