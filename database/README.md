# Hướng dẫn khởi tạo Database

## 1. Tạo schema (cấu trúc bảng)

```bash
mysql -u rfid_user -p'RfidPass123!' rfid_attendance < database/schema.sql
```

## 2. Thêm dữ liệu mẫu

```bash
mysql -u rfid_user -p'RfidPass123!' rfid_attendance < database/sample_data.sql
```

## 3. Kiểm tra database

```bash
mysql -u rfid_user -p'RfidPass123!' rfid_attendance -e "SHOW TABLES;"
mysql -u rfid_user -p'RfidPass123!' rfid_attendance -e "SELECT * FROM users;"
```

## Thông tin đăng nhập mặc định

### Admin Account
- **Username:** `admin`
- **Password:** `123456`
- **Role:** Admin (quản lý hệ thống)

### Staff Accounts (Nhân viên)
- **Username:** `staff001`, `staff002`, `staff003`
- **Password:** `123456`
- **Role:** at_work (chấm công thường xuyên)

### Event Account (Sự kiện)
- **Username:** `event001`
- **Password:** `123456`
- **Role:** event (chỉ tham gia sự kiện)

## Lưu ý

- Mật khẩu mặc định là `123456` - NÊN ĐỔI NGAY sau khi đăng nhập lần đầu!
- Hash mật khẩu trong file sample_data.sql là mẫu, cần sinh lại cho production
- File schema.sql sẽ XÓA và TẠO LẠI tất cả các bảng (dữ liệu cũ sẽ mất)

## Sinh mật khẩu mới với bcrypt (tùy chọn)

```javascript
const bcrypt = require('bcrypt');
const password = '123456';
const hash = bcrypt.hashSync(password, 10);
console.log(hash);
```

## Troubleshooting

Nếu gặp lỗi `Access denied`, kiểm tra lại:
1. Username và password MySQL
2. Database `rfid_attendance` đã được tạo
3. User đã được cấp quyền đúng

```sql
-- Cấp lại quyền nếu cần
GRANT ALL PRIVILEGES ON rfid_attendance.* TO 'rfid_user'@'localhost';
FLUSH PRIVILEGES;
```
