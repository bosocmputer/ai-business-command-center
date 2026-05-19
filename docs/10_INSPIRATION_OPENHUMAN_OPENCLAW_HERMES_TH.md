# Inspiration: OpenHuman, OpenClaw, Hermes Agent

## เป้าหมายของเอกสาร

สรุปแนวคิดที่นำมาปรับใช้จาก OpenHuman, OpenClaw และ Hermes Agent โดยไม่ copy codebase ทั้งหมด เพื่อสร้าง solution ที่เหมาะกับ SML subscription product

## Summary

```text
OpenHuman -> Command Center UX + memory/knowledge mindset
OpenClaw  -> Gateway + channel routing + permission mindset
Hermes    -> Skill/report system + cron + learning loop mindset

Our System -> SML Report Intelligence Platform
```

## OpenHuman Inspiration

สิ่งที่นำมาใช้:

- UI-first command center
- intelligence/memory concept
- local-first/privacy thinking
- typed tools ที่ agent เรียกใช้
- insight surface มากกว่าหน้าตารางธรรมดา

แปลเป็นระบบเรา:

```text
Report Snapshot = business memory
Dashboard = command center
Approved Report = typed business tool
```

สิ่งที่ไม่ใช้ใน phase 1:

- desktop mascot
- Tauri/Rust desktop shell
- full personal assistant runtime
- heavy OpenHuman build process

## OpenClaw Inspiration

สิ่งที่นำมาใช้:

- gateway concept
- multi-channel routing
- LINE/channel awareness
- allowlist and permission
- session isolation

แปลเป็นระบบเรา:

```text
LINE OA Gateway
tenant_id + channel_id + target_id routing
role/permission before answering future chatbot
```

สิ่งที่ไม่ใช้ใน phase 1:

- full multi-agent host control
- broad personal assistant tools
- sandboxed autonomous sessions
- every messaging platform

## Hermes Agent Inspiration

สิ่งที่นำมาใช้:

- skill system
- cron scheduling
- learning loop from usage
- memory/search of past work
- gateway delivery to messaging platforms

แปลเป็นระบบเรา:

```text
Report = Skill
sales_goods_services = first implemented skill
morning_brief = scheduled skill
customer feedback = improve shared SML report library
```

สิ่งที่ไม่ใช้ใน phase 1:

- autonomous skill creation
- self-modifying agent behavior
- arbitrary terminal/tool execution
- model/provider switching UX

## Combined Product Principle

ระบบเราต้องเป็น:

```text
Dashboard-first
Report-first
LINE-first
AI-later
```

AI เป็น layer สรุป/เลือก report ไม่ใช่เจ้าของ business truth

## Design Guardrails

- ห้าม AI เขียน SQL production เอง
- รายงานต้องมาจาก approved report contract
- ทุกคำตอบของ chatbot อนาคตต้องอ้างอิง `report_key` และ `report_run_id`
- shared knowledge โตจาก report ที่ validated แล้ว
- channel gateway ต้องเคารพ tenant isolation เสมอ

## Strategic Position

เราไม่ได้สร้าง clone ของ OpenHuman/OpenClaw/Hermes

เราสร้าง vertical product:

```text
AI Business Command Center for SML
```

โดยใช้ pattern ที่เหมาะ:

- OpenHuman ทำให้ product ดูเป็น command center
- OpenClaw ทำให้ channel/LINE ปลอดภัย
- Hermes ทำให้ report กลายเป็น skill และ scheduled automation
