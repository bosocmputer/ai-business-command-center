# Context Glossary

เอกสารนี้เป็นศัพท์กลางสำหรับคุยเรื่อง Owner onboarding, SML connection, LINE และแผนแจ้งเตือน

## Tenant

ร้านค้าหรือบริษัทลูกค้าหนึ่งรายในระบบ ทุกข้อมูลลูกค้า เช่น SML connection, LINE target, report run และ notification plan ต้องผูก `tenant_id`

## System DB

ฐานข้อมูลของระบบ AI-Business Command Center เอง ใช้ PostgreSQL เพื่อเก็บร้านค้า, secret metadata, report snapshot, LINE delivery, notification plan, audit และ worker state. System DB ไม่ใช่ฐาน SML ของร้านค้า

Runtime/business config ต้องอยู่ใน System DB หรือ encrypted store ผ่าน Owner UI เป็นหลัก. Env เหลือเฉพาะ bootstrap/container values ที่ระบบต้องใช้ก่อนอ่าน DB เช่น `SYSTEM_DATABASE_URL`, `AI_BCC_SECRET_KEY`, `OWNER_AUTH_SECRET`, port และ worker bootstrap token/API base

## SML Connection

ช่องทางอ่านข้อมูล SML ต่อร้านใช้ JavaWS-only:

- `sml_javaws`: ต่อผ่าน Tomcat `SMLJavaWebService` ด้วย `_queryCompress`

Owner config ต่อร้านผ่านหน้า `/owner/sml-connections` โดยกรอก 4 ค่าหลัก: Tomcat URL/host, port, `SMLConfigxxxx.xml` และ database. ร้านที่มี config เก่าแบบ non-JavaWS ให้ถือว่า “ต้องตั้งค่า SML ใหม่” ไม่ migrate อัตโนมัติ

## LINE Channel

LINE OA metadata และ secret เช่น channel access token/channel secret หนึ่งร้านมีหลาย LINE OA ได้ และ LINE OA สามารถเป็น `tenant` หรือ `owner_shared` scope ได้. `owner_shared` คือ LINE OA ของ Owner ที่ร้านอื่นเลือกใช้ได้เมื่อยังไม่มี OA ของตัวเอง

LINE OA และผู้รับไม่อ่านจาก `LINE_*` env fallback ใน runtime flow ใหม่. ต้องบันทึก token/secret ผ่าน Owner UI และค้นพบ target ผ่าน webhook approval

## LINE Target

ปลายทางรับข้อความ LINE เช่น user/group/room ต้องถูกค้นพบจาก webhook แล้ว Owner อนุมัติในระบบก่อนใช้งาน ห้ามให้ UI หลักกรอก raw userId/groupId/roomId ใน v1. Target ที่มาจาก Owner shared LINE OA สามารถถูกแสดงเป็น virtual target ของร้านอื่นได้ แต่ยังส่งผ่าน LINE OA ต้นทางเดิม

## Notification Plan

ชื่อใน UI คือ “แผนแจ้งเตือน” ส่วนชื่อ model/API ยังใช้ `notification_rules`. แผนต่อร้านบอกว่า:

- ส่งรายงานอะไร
- ส่งให้ LINE target/ผู้รับใด
- ส่งวันและเวลาไหน
- ใช้ช่วงข้อมูลแบบใด เช่น `yesterday`, `today_so_far`, `last_7_days`

Worker อ่าน rule จาก DB ผ่าน API ทุก 30 วินาที ไม่อ่านรายชื่อร้าน/เวลาจาก env เป็นหลัก

## Notification Rule Run

ประวัติการ execute plan หนึ่งรอบเวลา เก็บ scheduled local date/time, period range, status, attempt, idempotency key, report run ids, delivery ids และ safe error สำหรับแสดงใน Owner UI

## Business Signal

ข้อสังเกตเชิงธุรกิจที่ระบบสร้างจาก report snapshot หลัง report run สำเร็จ เช่น ยอดขายหาย, มีรายการขายไม่ระบุสาขา, margin ต่ำ, กำไรติดลบ หรือยอดซื้อกระจุกที่ผู้จำหน่ายรายเดียว. Business Signal ต้องมี evidence เสมอ ได้แก่ report/run ต้นทาง, period, rule version, ตัวเลขที่ trigger และ recommended action

Business Signal v1 เป็น deterministic rule ไม่ใช้ AI สร้างคำแนะนำเอง เพื่อให้ตรวจสอบย้อนกลับได้. ถ้า report fail หรือข้อมูลคุณภาพไม่พอ ระบบต้องสร้าง signal หมวด `data_quality` แทนการสรุปธุรกิจปลอม

## Action Digest

LINE digest รุ่นใหม่ที่ส่ง “เรื่องที่ควรทำวันนี้” แทนการส่งรายงานครบทุกใบเสมอ. v1 จำกัดไม่เกิน 3 priority signals ต่อรอบและ fallback เป็น report digest เดิมเมื่อร้านยังไม่เปิด `line_action_digest_v2_enabled` หรือไม่มี signal สำคัญ. Signal ต้อง inherit สิทธิ์จาก report ต้นทาง เช่น ผู้รับที่ไม่มีสิทธิ์ดูรายงานกำไรต้องไม่เห็น signal กำไร

Business Signal มี lifecycle `open`, `acknowledged`, `resolved`, `dismissed` เพื่อให้ Owner ทำงานต่อจาก alert ได้ ไม่ใช่แค่เห็นข้อความแล้วหายไป. การเปลี่ยนสถานะต้อง audit เสมอ

เกณฑ์ Business Signal ตั้ง override ต่อร้านได้ เช่น margin ต่ำ, ยอดขายตก, ยอดซื้อกระจุก, ยอดไม่ระบุสาขา และ no-sales policy. ถ้าร้านยังไม่ตั้งเอง ระบบใช้ default กลางก่อน ไม่ block การใช้งาน

แผนแจ้งเตือนมี `digest_mode`: `action_only` สำหรับส่ง Action Digest เป็นหลัก และ `all_reports` สำหรับส่งรายงานที่เลือกครบทุกใบ. Tenant flag `line_action_digest_v2_enabled` ยังเป็น rollout gate ก่อนส่ง Action Digest จริง
