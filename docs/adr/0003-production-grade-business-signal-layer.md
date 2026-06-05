# ADR 0003: Production-Grade Business Signal Layer

Date: 2026-06-05

## Status

Accepted

## Context

AI-Business Command Center เริ่มจากการส่งรายงาน SML เข้า LINE OA แต่ feedback ด้านการขายชัดเจนว่า “รายงาน” อย่างเดียวดูธรรมดาและไม่สร้างแรงจูงใจพอสำหรับเจ้าของร้าน. ลูกค้าต้องการรู้ว่ามีเรื่องไหนต้องจัดการ เช่น ยอดขายตก กำไรรั่ว ข้อมูลสาขาไม่ครบ หรือ supplier concentration มากผิดปกติ

ระบบมี report snapshot ที่ตรวจสอบได้แล้ว 4 รายงาน ได้แก่ sales, purchase, gross profit by product และ gross profit by AR customer. จึงสามารถสร้าง signal แบบ deterministic จาก snapshot โดยไม่ query SML เพิ่มและไม่ใช้ AI สรุปเองใน v1

## Decision

เพิ่ม `Business Signal Engine` เป็นชั้นกลางหลัง report run:

- สร้าง signal จาก report snapshot ที่ run สำเร็จเท่านั้น
- ถ้า report fail, stale หรือคุณภาพข้อมูลไม่พอ ให้สร้าง `data_quality` signal แทนการสรุปธุรกิจปลอม
- ทุก signal ต้องมี evidence: source report/run, period, rule version, trigger metric และ recommended action
- บันทึกลง `business_signals` ใน System DB แบบ idempotent ด้วย tenant/period/dimension key
- LINE Action Digest v2 ส่งเฉพาะ priority signals สูงสุด 3 เรื่องต่อรอบ และ fallback เป็น report digest เดิมเมื่อยังไม่เปิด feature flag หรือไม่มี signal
- Signal inherit permission จาก report ต้นทางก่อนส่ง LINE

## Consequences

ข้อดี:

- Product positioning เปลี่ยนจาก “ส่งรายงาน” เป็น “เตือนเรื่องที่ต้องทำ”
- ลด alert fatigue เพราะไม่ต้องส่งทุก report ทุกครั้ง
- ตรวจสอบย้อนหลังได้เพราะทุก signal ผูกกับ report snapshot/run
- Performance ดีขึ้นเพราะใช้ snapshot เดิม ไม่ยิง JavaWS ซ้ำต่อ signal หรือผู้รับ

Tradeoffs:

- v1 ยังไม่ครอบคลุม stock และ AR aging จนกว่าจะมี query เพิ่ม
- Signed dashboard ยังเปิดจาก report scope เป็นหลัก ส่วน signal scope เพิ่มได้ในรอบถัดไป

Follow-up implemented:

- Owner ตั้ง threshold override ต่อร้านได้ โดยยังมี default กลางเมื่อไม่ตั้งค่า
- Business Signal มี lifecycle `open`, `acknowledged`, `resolved`, `dismissed` และ audit ทุกครั้งที่เปลี่ยนสถานะ
- Notification Rule เลือก `digest_mode` ได้ระหว่าง Action Digest เป็นหลักกับส่ง report ครบทุกใบ

## Rollout

- `business_signals_enabled` เปิด default ต่อร้าน
- `line_action_digest_v2_enabled` ปิด default เพื่อให้ Owner เปิดทีละร้านหลังทดสอบ
- Demo mode ต้องติด badge “ข้อมูลตัวอย่าง” และห้ามส่งเข้า LINE ลูกค้าจริงโดยไม่ระบุว่าเป็น demo
