# Admin Runbook: เพิ่มร้านและเปิดแผนแจ้งเตือน

## เป้าหมาย

ทำให้ร้านหนึ่งพร้อมใช้งานตั้งแต่เพิ่มร้าน, เชื่อม SML ผ่าน JavaWS, ตั้ง LINE OA/ผู้รับ, สร้างแผนแจ้งเตือน และส่งทดสอบจริง

## ขั้นตอน

1. เข้า `/owner`
2. เลือกร้านใน Store Setup Cockpit
3. ถ้ายังไม่มีร้าน ให้เพิ่มจากหน้า `/owner`
4. กด next action “ตรวจ SML” หรือเข้า `/owner/sml-connections`
5. กรอก 4 ค่า SML JavaWS:
   - Tomcat host/URL
   - port
   - `SMLConfigxxxx.xml`
   - database
6. กด “ทดสอบค่าที่กรอก” ให้ผ่าน แล้วกด “บันทึกการเชื่อม SML”
7. กด CTA ทดสอบรายงานจาก readiness checklist หรือเข้า `/owner/reports` เฉพาะเมื่อใช้ diagnostic tool
8. ไป `/owner/line`
9. เลือกใช้ Owner shared LINE OA หรือเพิ่ม LINE OA ของร้านเอง
10. ให้ผู้รับ add OA แล้วพิมพ์ `test`
11. อนุมัติผู้รับ, เลือกสิทธิ์รายงาน, เปิดรับ, แล้วส่งทดสอบผู้รับ
12. ไป `/owner/notifications`
13. สร้างแผนแจ้งเตือน:
    - เลือกรายงาน
    - เลือกผู้รับ LINE
    - เลือกวัน
    - เพิ่มเวลาอย่างน้อย 1 รอบ
    - เลือกช่วงข้อมูล
14. บันทึกเป็น draft ได้ก่อน
15. เปิดใช้งานหรือส่งจริงหลัง readiness ผ่านเท่านั้น

## Error ที่เจอบ่อย

- Tomcat unreachable: ตรวจ URL, port, VPN, firewall, reverse proxy allowlist
- WSDL/operation missing: ตรวจ webapp path `/SMLJavaWebService` และ endpoint `DotNetFrameWork`
- config/database ผิด: ตรวจ `SMLConfigxxxx.xml` และ database ที่ร้านใช้จริง
- table missing: SML database อาจไม่ใช่ฐานที่มีเอกสารขาย/ซื้อที่รายงานต้องใช้
- LINE token/secret ไม่พร้อม: บันทึก token/secret ในหน้า LINE OA แล้วทดสอบส่งใหม่
- ผู้รับไม่มีสิทธิ์: ปรับ profile หรือ allowed reports ก่อนเลือกในแผนแจ้งเตือน

## ข้อควรจำ

- SML ของร้านค้าใช้ JavaWS-only
- System DB PostgreSQL เป็นฐานของ AI-Business เอง ไม่ใช่ SML ของร้าน
- ห้ามเปิด Tomcat public โล่ง ๆ ควรอยู่หลัง LAN/VPN/firewall/reverse proxy allowlist
- ห้ามกรอก raw LINE userId/groupId/roomId เองใน UI หลัก ผู้รับต้องมาจาก webhook approval
