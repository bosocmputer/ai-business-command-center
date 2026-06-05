# ADR 0002: SML Tenant Datasource ใช้ JavaWS-only

Date: 2026-06-01

## Status

Accepted

## Context

ร้าน SML หลายร้านไม่ได้เปิด PostgreSQL port `5432` ออกมานอกเครื่องหรือวง LAN แต่มี Tomcat ที่รัน `SMLJavaWebService` อยู่แล้ว. Owner/Admin ต้องเพิ่มร้านและตั้งค่าเองผ่าน UI โดยไม่แก้ env และไม่แก้โปรเจกต์ `smljavaws2`

System DB ของ AI-Business ยังเป็น PostgreSQL สำหรับเก็บ tenant, snapshot, LINE, notification plan, secret metadata และ audit. ข้อนี้แยกจาก SML datasource ของร้านค้า

## Options

- รองรับทั้ง PostgreSQL direct และ JavaWS: ยืดหยุ่น แต่ทำให้ UI/Admin งงง่ายและมีสอง runtime path ให้ debug
- JavaWS-only สำหรับ SML ของร้านค้า: config เหลือ 4 ค่าหลัก, ใช้ Tomcat ที่ร้านมีอยู่แล้ว และลด support surface
- สร้าง local connector ใหม่: คุม protocol ได้เอง แต่ต้อง deploy/maintain agent เพิ่มในแต่ละร้าน

## Scale And Failure Modes

JavaWS-only ยังต้องรับมือ Tomcat unreachable, wrong port, wrong `SMLConfigxxxx.xml`, database missing, bad XML, timeout และ table missing. API ต้องคืน safe error ภาษาไทยและห้าม log secret หรือ raw SQL

Notification worker ต้องใช้ readiness เดียวกับ Owner UI: ถ้า SML JavaWS ไม่พร้อม ห้ามส่ง LINE จริง

## Decision

SML datasource ของร้านค้าใช้ `sml_javaws` เท่านั้นใน flow ใหม่. Owner UI แสดง 4 ช่องหลัก: Tomcat host/URL, port, `SMLConfigxxxx.xml`, database. Advanced fields เช่น protocol, webapp path, endpoint, auth และ query method ซ่อนไว้

Backend config update รับเฉพาะ JavaWS. ถ้าพบ config เก่าแบบ non-JavaWS ให้ถือว่า “ต้องตั้งค่า SML ใหม่” และไม่ migrate อัตโนมัติ

## Consequences

- Admin ไม่ต้องรู้ DB username/password ของ SML
- ร้านที่ปิด port PostgreSQL ยัง onboarding ได้ผ่าน Tomcat
- Report runner และ notification worker มี runtime path หลักเดียวสำหรับ SML
- ยังต้อง monitor performance ของ JavaWS เพราะ SOAP/XML/compress path อาจช้ากว่า direct DB

## Regret Check

ถ้าในอนาคตมีร้านขนาดใหญ่มากที่ JavaWS ช้าเกินไป อาจต้องเพิ่ม connector หรือ read replica เป็น channel ใหม่ แต่ไม่ควรเอา PostgreSQL direct กลับเข้า Owner flow หลักโดยไม่มี UX/operational decision ใหม่
