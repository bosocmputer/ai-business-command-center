# Admin Runbook: เพิ่มร้านและเปิดแผนแจ้งเตือน

## เป้าหมาย

ทำให้ร้านหนึ่งพร้อมใช้งานตั้งแต่เพิ่มร้าน, เชื่อม SML ผ่าน JavaWS, ตั้ง LINE OA/ผู้รับ, สร้างแผนแจ้งเตือน และส่งทดสอบจริง

## ขั้นตอน

1. เข้า `/owner`
2. เลือกร้านใน Store Setup Cockpit
3. ถ้ายังไม่มีร้าน ให้เข้า `/owner/tenants` แล้วใช้แผง “เพิ่มร้านใหม่”
   - กรอกชื่อร้าน
   - ตรวจ `tenant_id` ที่ระบบสร้างให้ หรือแก้ก่อนสร้าง
   - เลือกแพ็กเกจเริ่มต้น
   - ใส่อีเมล viewer/note ภายในถ้ามี
   - ห้ามใส่ SML/LINE secret ใน note
4. หลังสร้างร้าน ให้กด CTA “เชื่อม SML ร้านนี้” หรือเข้า `/owner/sml-connections?tenant=<tenant_id>`
5. กด next action “ตรวจ SML” หรือเข้า `/owner/sml-connections`
6. กรอก 4 ค่า SML JavaWS:
   - Tomcat host/URL
   - port
   - `SMLConfigxxxx.xml`
   - database
7. กด “ทดสอบค่าที่กรอก” ให้ผ่าน เพื่อยืนยันว่า JavaWS ตอบได้จากค่าบนฟอร์ม
8. กด “บันทึกการเชื่อม SML” เพื่อให้ API/worker ใช้ค่านี้จริง
9. กด “ทดสอบค่าที่บันทึก” ให้ผ่าน ก่อนเปิดแผนแจ้งเตือน
10. กด CTA ทดสอบรายงานจาก readiness checklist หรือเข้า `/owner/reports` เฉพาะเมื่อใช้ diagnostic tool
11. ไป `/owner/line`
12. เลือกใช้ Owner shared LINE OA หรือเพิ่ม LINE OA ของร้านเอง
13. ให้ผู้รับ add OA แล้วพิมพ์ `test`
14. อนุมัติผู้รับ, เลือกสิทธิ์รายงาน, เปิดรับ, แล้วส่งทดสอบผู้รับ
15. ไป `/owner/notifications`
16. สร้างแผนแจ้งเตือน:
    - เลือกรายงาน
    - เลือกผู้รับ LINE
    - เลือกวัน
    - เพิ่มเวลาอย่างน้อย 1 รอบ
    - เลือกช่วงข้อมูล
17. บันทึกเป็น draft ได้ก่อน
18. เปิดใช้งานหรือส่งจริงหลัง readiness ผ่านเท่านั้น

## Error ที่เจอบ่อย

- Tomcat unreachable: ตรวจ URL, port, VPN, firewall, reverse proxy allowlist
- WSDL/operation missing: ตรวจ webapp path `/SMLJavaWebService` และ endpoint `DotNetFrameWork`
- config/database ผิด: ตรวจ `SMLConfigxxxx.xml` และ database ที่ร้านใช้จริง
- ทดสอบค่าที่กรอกผ่านแต่ยังส่งจริงไม่ได้: ต้องกด “บันทึกการเชื่อม SML” และ “ทดสอบค่าที่บันทึก” อีกครั้งก่อน worker จะใช้จริง
- table missing: SML database อาจไม่ใช่ฐานที่มีเอกสารขาย/ซื้อที่รายงานต้องใช้
- LINE token/secret ไม่พร้อม: บันทึก token/secret ในหน้า LINE OA แล้วทดสอบส่งใหม่
- ผู้รับไม่มีสิทธิ์: ปรับ profile หรือ allowed reports ก่อนเลือกในแผนแจ้งเตือน

## ข้อควรจำ

- SML ของร้านค้าใช้ JavaWS-only
- System DB PostgreSQL เป็นฐานของ AI-Business เอง ไม่ใช่ SML ของร้าน
- ห้ามเปิด Tomcat public โล่ง ๆ ควรอยู่หลัง LAN/VPN/firewall/reverse proxy allowlist
- ห้ามกรอก raw LINE userId/groupId/roomId เองใน UI หลัก ผู้รับต้องมาจาก webhook approval
