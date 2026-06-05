# ADR 0001: DB-backed Notification Rule Scheduler

Date: 2026-06-01

## Status

Accepted

## Context

เดิม worker ส่ง Morning Brief ด้วย config ระดับระบบ เช่น tenant ids และเวลาจาก env/runtime fallback ทำให้ scale หลายร้านยาก และ Owner ตั้งค่าเองไม่ได้ว่าร้านไหนส่งรายงานอะไร ส่งวันไหน กี่โมง และส่งให้ LINE target ใด

ระบบใหม่ต้องรองรับ onboarding หลายร้าน, หลายปลายทาง LINE, หลาย report key และตรวจสิทธิ์ผู้รับก่อนบันทึกกฎ

## Decision

เพิ่ม `notification_rules` และ `notification_rule_runs` ใน system store แล้วให้ worker เรียก `POST /api/worker/notification-rules/tick` ทุก 30 วินาที

API เป็นตัว:

- อ่าน rule ที่ due ตาม timezone/local weekday/time
- enforce idempotency key ต่อ rule + local date + local time + attempt
- run รายงานสดหนึ่งครั้งต่อ rule execution
- สร้าง LINE digest หนึ่งข้อความต่อ target
- บันทึก run, delivery ids, safe error และ retry 1 ครั้งตาม policy

Owner ตั้งค่าผ่าน `/owner/notifications`; env Morning Brief เดิมเหลือเป็น runtime status/fallback เท่านั้น ไม่ migrate เป็น rule อัตโนมัติใน flow ใหม่

## Consequences

- Owner ไม่ต้องแก้ env เพื่อเพิ่มร้านหรือเปลี่ยนเวลาแจ้งเตือน
- Audit ชัดขึ้น เพราะ rule run trace ไปที่ report runs และ line deliveries ได้
- Worker ต้องมี worker token และ API ต้องพร้อมก่อน tick
- v1 ยังจำกัดเป็น recurring weekly schedule, LINE delivery channel และ digest packaging เท่านั้น
