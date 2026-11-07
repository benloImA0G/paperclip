import { describe, expect, it } from "vitest";
import { classifyCouncilQuestion, type CouncilKind } from "../services/council-modes.js";

const corpus: Array<[CouncilKind, string]> = [
  ["quick-fact", "What port does PostgreSQL use"],
  ["quick-fact", "Who founded Python?"],
  ["quick-fact", "When was Node.js released?"],
  ["quick-fact", "How many bytes are in a kilobyte?"],
  ["quick-fact", "Where is the config file?"],
  ["quick-fact", "Does SQLite support transactions?"],
  ["quick-fact", "Apa itu Docker"],
  ["quick-fact", "Berapa port default Postgres?"],
  ["quick-fact", "Siapa yang membuat Linux"],
  ["quick-fact", "Kapan Node.js dirilis"],
  ["quick-fact", "Di mana file konfigurasi disimpan?"],
  ["quick-fact", "Apa arti API dalam bahasa Indonesia"],
  ["decision", "We need to decide between SQLite and Postgres for storage."],
  ["decision", "Should we launch this week or wait?"],
  ["decision", "Which option is better for a small team?"],
  ["decision", "Postgres vs SQLite for this app"],
  ["decision", "Is the migration worth it?"],
  ["decision", "Pick a database for our new service."],
  ["plan-and-do", "Draft a welcome email for customers joining our service"],
  ["decision", "Sebaiknya pakai Postgres atau SQLite untuk aplikasi ini"],
  ["decision", "Pilih database yang cocok untuk tim kecil"],
  ["decision", "Mana yang lebih baik, deploy sekarang atau besok"],
  ["decision", "Apakah sebaiknya kita pindah ke cloud?"],
  ["decision", "Kita perlu memilih antara React dan Vue"],
  ["decision", "Lebih baik upgrade server atau optimasi query dulu?"],
  ["brainstorm", "Brainstorm names for the new dashboard"],
  ["brainstorm", "Give me ideas for a launch event"],
  ["brainstorm", "Suggest alternatives for onboarding new users"],
  ["brainstorm", "What if we made the product free?"],
  ["brainstorm", "How might we encourage more feedback?"],
  ["brainstorm", "What are some creative ways to retain customers?"],
  ["brainstorm", "Kasih ide untuk nama dashboard baru"],
  ["brainstorm", "Beri saran untuk meningkatkan onboarding pengguna"],
  ["brainstorm", "Ada ide apa untuk acara peluncuran?"],
  ["brainstorm", "Cari alternatif cara menarik pelanggan baru"],
  ["brainstorm", "Bagaimana cara meningkatkan engagement komunitas?"],
  ["brainstorm", "Tolong suggest beberapa ide untuk fitur baru"],
  ["review", "Review this migration; should we merge it?"],
  ["review", "Audit the deployment plan for problems"],
  ["review", "Find flaws in this proposal"],
  ["review", "What is wrong with this design?"],
  ["review", "Critique our pricing strategy"],
  ["review", "Stress-test the rollout plan"],
  ["review", "Periksa rencana migrasi ini sebelum kita deploy"],
  ["review", "Tinjau proposal ini apakah sebaiknya kita lanjut?"],
  ["review", "Cari kelemahan dari desain ini"],
  ["review", "Apa risikonya kalau kita pakai pendekatan ini?"],
  ["review", "Tolong cek dokumen ini untuk kesalahan"],
  ["review", "Evaluasi keamanan rencana deployment ini"],
  ["plan-and-do", "Build a landing page with pricing, testimonials, and a signup form"],
  ["plan-and-do", "Write a migration plan and implement the database changes for the new service"],
  ["plan-and-do", "Please prepare a release checklist for the next product launch"],
  ["plan-and-do", "Create a dashboard showing weekly sales and customer growth"],
  ["decision", "Fix it"],
  ["plan-and-do", "Set up a project, install dependencies, implement the API, write tests, and prepare instructions for deploying the completed service"],
  ["plan-and-do", "Tolong buatkan halaman dashboard dengan grafik penjualan mingguan"],
  ["plan-and-do", "Siapkan laporan penjualan bulan ini untuk tim marketing"],
  ["plan-and-do", "Buatkan rencana migrasi database lengkap dengan langkah rollback"],
  ["plan-and-do", "Tolong perbaiki bug pada halaman login setelah submit form"],
  ["plan-and-do", "Bikin aplikasi sederhana untuk mencatat pengeluaran bulanan"],
  ["plan-and-do", "Tolong buat draft email untuk mengumumkan fitur baru"],
];

describe("bilingual council mode corpus", () => {
  it.each(corpus)("classifies %s: %s", (kind, question) => {
    expect(classifyCouncilQuestion(question).kind).toBe(kind);
  });

  it("uses one reason per kind, including defaults", () => {
    expect(classifyCouncilQuestion("").reason).toBe(classifyCouncilQuestion("Apa itu Docker").reason);
    expect(classifyCouncilQuestion("fix it").reason).toBe(classifyCouncilQuestion("Should we wait?").reason);
  });

  it("matches cues case-insensitively and on word boundaries", () => {
    expect(classifyCouncilQuestion("PERIKSA proposal ini").kind).toBe("review");
    expect(classifyCouncilQuestion("What is a reviewable artifact").kind).toBe("quick-fact");
  });
});
