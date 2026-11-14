import { auth, db } from "./firebase.js";

import { signInAnonymously } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// =====================================
// 1. URL PARAMETERS
// =====================================

const params = new URLSearchParams(window.location.search);

const sessionId = params.get("sessionId");
// Token dinamis dari QR (parameter "t")
const dynamicToken = params.get("t");

// =====================================
// 2. ELEMENTS
// =====================================

const $ = (id) => document.getElementById(id);

const loadingState = $("loadingState");
const loadingText = $("loadingText");
const sessionContent = $("sessionContent");
const errorState = $("errorState");
const successState = $("successState");

const nimInput = $("nimInput");
const checkButton = $("checkButton");
const submitButton = $("submitButton");

const studentInfo = $("studentInfo");
const messageBox = $("messageBox");

// =====================================
// 3. VARIABLES
// =====================================

let currentSession = null;
let currentStudent = null;
let currentMembership = null;

// Data token QR dinamis yang sudah divalidasi saat halaman dimuat
let currentToken = null;

let isSubmitting = false;
let isChecking = false;

// Cache hasil verifikasi NIM (hanya selama halaman terbuka)
let verifiedNim = null;

// =====================================
// 4. MESSAGE
// =====================================

function showMessage(message, type = "error") {
  messageBox.textContent = message;

  messageBox.className =
    "rounded-xl p-3 text-sm " +
    (type === "success"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-600");

  messageBox.classList.remove("hidden");
}

function hideMessage() {
  messageBox.classList.add("hidden");
}

// =====================================
// 5. ERROR
// =====================================

function showError(message) {
  loadingState.classList.add("hidden");
  sessionContent.classList.add("hidden");
  successState.classList.add("hidden");

  errorState.classList.remove("hidden");

  $("errorText").textContent = message;
}

// =====================================
// 6. AUTHENTICATION
// =====================================

async function initializeStudentAuth() {
  try {
    loadingText.textContent = "Menghubungkan autentikasi mahasiswa...";

    await auth.authStateReady();

    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    if (!auth.currentUser) {
      throw new Error("Firebase Authentication tidak menghasilkan user.");
    }

    return true;
  } catch (error) {
    console.error("Authentication error:", error);

    let message = "Gagal melakukan autentikasi mahasiswa.";

    if (error.code === "auth/operation-not-allowed") {
      message = "Anonymous Authentication belum diaktifkan.";
    } else if (error.code === "auth/network-request-failed") {
      message = "Koneksi internet bermasalah.";
    }

    showError(message);
    return false;
  }
}

// =====================================
// 7. VALIDATION
// =====================================

function isSessionValid(session) {
  if (!session || session.status !== "active") {
    return false;
  }

  const now = Date.now();

  const start = session.startsAt?.toDate?.().getTime();
  const end = session.expiresAt?.toDate?.().getTime();

  return (
    Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end
  );
}

function isTokenValid(tokenData) {
  const expires = tokenData?.expiresAt?.toDate?.().getTime();

  return Number.isFinite(expires) && Date.now() <= expires;
}

// =====================================
// 8. FORMAT DATE
// =====================================

function formatDate(value) {
  if (!value) return "-";

  return new Date(value + "T00:00:00").toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  });
}

function formatTime(timestamp) {
  return timestamp.toDate().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Makassar",
  });
}

// =====================================
// 9. LOAD SESSION + VALIDASI TOKEN DINAMIS
// =====================================

async function loadSession() {
  if (!sessionId || !dynamicToken) {
    showError("QR Code tidak memiliki informasi sesi yang lengkap.");
    return;
  }

  try {
    loadingText.textContent = "Memeriksa sesi absensi...";

    // A. Baca dokumen token dinamis dan dokumen sesi secara paralel
    const [tokenSnapshot, sessionSnapshot, lockSnapshot] = await Promise.all([
      getDoc(doc(db, "sessions", sessionId, "qrTokens", dynamicToken)),
      getDoc(doc(db, "sessions", sessionId)),
      // Kunci perangkat: 1 perangkat (UID anonim) hanya boleh absen 1 kali per sesi
      getDoc(
        doc(db, "sessions", sessionId, "deviceLocks", auth.currentUser.uid),
      ),
    ]);

    // B. Validasi token dinamis
    if (!tokenSnapshot.exists()) {
      showError("QR Code tidak valid. Pindai ulang QR Code dari layar dosen.");
      return;
    }

    const tokenData = tokenSnapshot.data();

    if (tokenData.sessionId !== sessionId || tokenData.token !== dynamicToken) {
      showError("QR Code tidak sesuai dengan sesi absensi.");
      return;
    }

    if (!isTokenValid(tokenData)) {
      showError("QR Code sudah kedaluwarsa. Pindai ulang QR Code terbaru.");
      return;
    }

    // C. Validasi sesi
    if (!sessionSnapshot.exists()) {
      showError("Sesi absensi tidak ditemukan.");
      return;
    }

    const session = sessionSnapshot.data();

    if (!isSessionValid(session)) {
      showError("Sesi belum dimulai, sudah berakhir, atau telah ditutup.");
      return;
    }

    // D. Perangkat ini sudah dipakai absen pada sesi/pertemuan ini
    if (lockSnapshot.exists()) {
      const usedBy = lockSnapshot.data().studentNim;

      showError(
        "Perangkat ini sudah digunakan untuk absensi" +
          (usedBy ? " (NIM " + usedBy + ")" : "") +
          " pada pertemuan ini. Satu perangkat hanya dapat absen satu kali.",
      );
      return;
    }

    if (
      !session.courseId ||
      !session.courseCode ||
      !session.courseName ||
      !session.classId ||
      !session.className ||
      !session.date ||
      session.meeting == null ||
      !session.startsAt ||
      !session.expiresAt
    ) {
      showError("Informasi sesi atau kelas belum lengkap.");
      return;
    }

    currentToken = tokenData;

    currentSession = {
      id: sessionSnapshot.id,
      ...session,
    };

    $("courseName").textContent = session.courseName;
    $("courseCode").textContent = session.courseCode;
    $("className").textContent = session.className;

    // Field di halaman admin bernama lecturerName
    $("lecturerName").textContent = session.lecturerName
      ? "Dosen: " + session.lecturerName
      : "";

    $("meetingNumber").textContent = "Pertemuan " + session.meeting;
    $("sessionDate").textContent = formatDate(session.date);

    $("sessionTime").textContent =
      `${formatTime(session.startsAt)} - ${formatTime(session.expiresAt)}`;

    loadingState.classList.add("hidden");
    sessionContent.classList.remove("hidden");
  } catch (error) {
    console.error("Load session error:", error);

    if (error.code === "permission-denied") {
      showError("Akses ditolak. QR Code tidak valid atau sudah kedaluwarsa.");
    } else {
      showError(`Gagal memuat sesi: ${error.code || error.message}`);
    }
  }
}

// =====================================
// 10. RESET VERIFICATION
// =====================================

function resetVerification() {
  verifiedNim = null;

  currentStudent = null;
  currentMembership = null;

  submitButton.disabled = true;

  studentInfo.classList.add("hidden");

  hideMessage();
}

// =====================================
// 11. CHECK STUDENT
// =====================================

async function checkStudent() {
  if (isChecking || isSubmitting) return;

  const nim = nimInput.value.trim();

  hideMessage();

  if (!nim) {
    resetVerification();
    showMessage("Masukkan NIM terlebih dahulu.");
    nimInput.focus();
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(nim)) {
    resetVerification();
    showMessage("Format NIM tidak valid.");
    return;
  }

  if (!currentSession || !isSessionValid(currentSession)) {
    resetVerification();
    showMessage("Sesi absensi sudah tidak aktif.");
    return;
  }

  if (!isTokenValid(currentToken)) {
    resetVerification();
    showMessage("QR Code sudah kedaluwarsa. Pindai ulang QR Code terbaru.");
    return;
  }

  // Cache: NIM sudah diverifikasi
  if (verifiedNim === nim && currentStudent && currentMembership) {
    studentInfo.classList.remove("hidden");
    submitButton.disabled = false;

    showMessage(
      "NIM sudah diverifikasi. Silakan konfirmasi kehadiran.",
      "success",
    );

    return;
  }

  isChecking = true;

  checkButton.disabled = true;
  checkButton.textContent = "Memeriksa...";

  submitButton.disabled = true;

  try {
    // A. Dokumen mahasiswa
    const studentSnapshot = await getDoc(doc(db, "students", nim));

    if (!studentSnapshot.exists()) {
      resetVerification();
      showMessage("NIM tidak ditemukan. Hubungi administrator.");
      return;
    }

    const student = studentSnapshot.data();

    if (student.nim && student.nim !== nim) {
      resetVerification();
      showMessage("Data NIM tidak sesuai.");
      return;
    }

    if (student.status && student.status !== "active") {
      resetVerification();
      showMessage("Status mahasiswa tidak aktif.");
      return;
    }

    const studentName = String(student.name || "").trim();

    if (!studentName) {
      resetVerification();
      showMessage("Data nama mahasiswa tidak lengkap.");
      return;
    }

    // B. Dokumen keanggotaan kelas
    const membershipSnapshot = await getDoc(
      doc(db, "classMembers", `${currentSession.classId}_${nim}`),
    );

    if (!membershipSnapshot.exists()) {
      resetVerification();

      showMessage(
        "Anda tidak terdaftar sebagai anggota kelas " +
          currentSession.className +
          ". Absensi tidak dapat dilanjutkan.",
      );

      return;
    }

    const membership = membershipSnapshot.data();

    if (
      membership.classId !== currentSession.classId ||
      membership.studentNim !== nim ||
      membership.courseId !== currentSession.courseId
    ) {
      resetVerification();
      showMessage("Data keanggotaan kelas tidak sesuai.");
      return;
    }

    // C. Simpan hasil verifikasi
    currentStudent = { nim, name: studentName };

    currentMembership = {
      classId: membership.classId,
      className: membership.className,
      courseId: membership.courseId,
    };

    verifiedNim = nim;

    $("studentName").textContent = studentName;
    $("studentNim").textContent = "NIM: " + nim;
    $("studentClass").textContent = "Kelas: " + currentSession.className;

    studentInfo.classList.remove("hidden");

    submitButton.disabled = false;

    showMessage(
      "NIM dan keanggotaan kelas berhasil diverifikasi. Silakan konfirmasi kehadiran.",
      "success",
    );
  } catch (error) {
    console.error("Check student error:", error);

    resetVerification();

    if (error.code === "permission-denied") {
      showMessage(
        "Akses data mahasiswa atau keanggotaan kelas ditolak. Periksa Firestore Rules.",
      );
    } else if (error.code === "unavailable") {
      showMessage("Server tidak tersedia. Periksa koneksi internet.");
    } else {
      showMessage(`Gagal memeriksa NIM: ${error.code || error.message}`);
    }
  } finally {
    isChecking = false;

    checkButton.disabled = false;
    checkButton.textContent = "Periksa NIM";
  }
}

checkButton.addEventListener("click", checkStudent);

// =====================================
// 12. INPUT CHANGE
// =====================================

nimInput.addEventListener("input", () => {
  resetVerification();
});

// =====================================
// 13. SUBMIT ATTENDANCE
// =====================================

$("attendanceForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) return;

  if (!auth.currentUser) {
    showMessage("Autentikasi mahasiswa tidak tersedia.");
    return;
  }

  if (!currentSession || !currentStudent || !currentMembership) {
    showMessage("Periksa NIM dan keanggotaan kelas terlebih dahulu.");
    return;
  }

  if (nimInput.value.trim() !== verifiedNim) {
    resetVerification();
    showMessage("NIM berubah. Silakan periksa kembali.");
    return;
  }

  if (!isSessionValid(currentSession)) {
    showMessage("Sesi absensi sudah tidak aktif.");
    submitButton.disabled = true;
    return;
  }

  // Token dinamis harus masih berlaku saat absensi dikirim
  if (!isTokenValid(currentToken)) {
    submitButton.disabled = true;
    showMessage(
      "QR Code sudah kedaluwarsa. Pindai ulang QR Code terbaru untuk absen.",
    );
    return;
  }

  isSubmitting = true;

  submitButton.disabled = true;
  checkButton.disabled = true;
  nimInput.disabled = true;

  submitButton.textContent = "Menyimpan absensi...";

  try {
    const attendanceRef = doc(
      db,
      "attendance",
      `${sessionId}_${currentStudent.nim}`,
    );

    const attendanceData = {
      sessionId,

      studentNim: currentStudent.nim,
      studentName: currentStudent.name,

      courseId: currentSession.courseId,
      courseCode: currentSession.courseCode,
      courseName: currentSession.courseName,

      classId: currentMembership.classId,
      className: currentMembership.className,

      meetingNumber: currentSession.meeting,
      date: currentSession.date,

      status: "hadir",

      // Token dinamis yang dipindai; dipakai Firestore Rules untuk validasi
      qrToken: dynamicToken,

      createdAt: serverTimestamp(),
    };

    // Absensi dan kunci perangkat disimpan atomik dalam satu batch
    const lockRef = doc(
      db,
      "sessions",
      sessionId,
      "deviceLocks",
      auth.currentUser.uid,
    );

    const batch = writeBatch(db);

    batch.set(attendanceRef, attendanceData);

    batch.set(lockRef, {
      sessionId,
      studentNim: currentStudent.nim,
      deviceUid: auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    sessionContent.classList.add("hidden");
    successState.classList.remove("hidden");

    $("successName").textContent = currentStudent.name;
    $("successNim").textContent = "NIM: " + currentStudent.nim;

    $("successCourse").textContent =
      `${currentSession.courseName} - Pertemuan ${currentSession.meeting}`;

    $("successClass").textContent = "Kelas: " + currentMembership.className;
  } catch (error) {
    console.error("Attendance error:", error);

    if (error.code === "permission-denied") {
      showMessage(
        "Absensi ditolak. Kemungkinan: QR Code kedaluwarsa, sesi sudah ditutup, NIM ini sudah absen, atau perangkat ini sudah dipakai absen pada pertemuan ini.",
      );
    } else if (error.code === "unavailable") {
      showMessage("Server tidak tersedia. Periksa koneksi internet.");
    } else {
      showMessage(`Gagal menyimpan absensi: ${error.code || error.message}`);
    }
  } finally {
    isSubmitting = false;

    submitButton.textContent = "Konfirmasi Kehadiran";

    if (!successState.classList.contains("hidden")) {
      return;
    }

    nimInput.disabled = false;
    checkButton.disabled = false;

    submitButton.disabled =
      !currentStudent ||
      !currentMembership ||
      !isSessionValid(currentSession) ||
      !isTokenValid(currentToken);
  }
});

// =====================================
// 14. INITIALIZE
// =====================================

async function initialize() {
  const authenticated = await initializeStudentAuth();

  if (!authenticated) return;

  await loadSession();
}

initialize();
