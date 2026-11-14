import { auth, db } from "./firebase.js";

import { signInAnonymously } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// =====================================
// 1. URL PARAMETERS
// =====================================

const params = new URLSearchParams(window.location.search);

const sessionId = params.get("sessionId");
const token = params.get("token");

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

let isSubmitting = false;
let isChecking = false;

// Cache hasil verifikasi NIM.
// Cache hanya berlaku selama halaman masih terbuka.
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

    console.log("Autentikasi mahasiswa berhasil.");
    console.log("Anonymous UID:", auth.currentUser.uid);
    console.log("Firebase Project:", db.app.options.projectId);

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
// 7. SESSION VALIDATION
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
// 9. LOAD SESSION
// =====================================

async function loadSession() {
  if (!sessionId || !token) {
    showError("QR Code tidak memiliki informasi sesi yang lengkap.");
    return;
  }

  try {
    loadingText.textContent = "Memeriksa sesi absensi...";

    // Satu pembacaan dokumen sesi.
    const sessionRef = doc(db, "sessions", sessionId);
    const snapshot = await getDoc(sessionRef);

    if (!snapshot.exists()) {
      showError("Sesi absensi tidak ditemukan.");
      return;
    }

    const session = snapshot.data();

    if (!session.token || session.token !== token) {
      showError("Token QR Code tidak valid.");
      return;
    }

    if (!isSessionValid(session)) {
      showError("Sesi belum dimulai, sudah berakhir, atau telah ditutup.");
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

    currentSession = {
      id: snapshot.id,
      ...session,
    };

    $("courseName").textContent = session.courseName;
    $("courseCode").textContent = session.courseCode;

    $("className").textContent = session.className;

    $("lecturerName").textContent = session.lecturer
      ? "Dosen: " + session.lecturer
      : "";

    $("meetingNumber").textContent = "Pertemuan " + session.meeting;

    $("sessionDate").textContent = formatDate(session.date);

    $("sessionTime").textContent =
      `${formatTime(session.startsAt)} - ${formatTime(session.expiresAt)}`;

    loadingState.classList.add("hidden");
    sessionContent.classList.remove("hidden");

    console.log("Sesi berhasil dimuat:", sessionId);
  } catch (error) {
    console.error("Load session error:", error);

    showError(`Gagal memuat sesi: ${error.code || error.message}`);
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

  // ===================================
  // CACHE: NIM SUDAH DIVERIFIKASI
  // ===================================

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
    // =================================
    // A. BACA DOKUMEN MAHASISWA
    // =================================

    const studentRef = doc(db, "students", nim);
    const studentSnapshot = await getDoc(studentRef);

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

    // =================================
    // B. BACA DOKUMEN KEANGGOTAAN KELAS
    // =================================

    const membershipId = `${currentSession.classId}_${nim}`;

    const membershipRef = doc(db, "classMembers", membershipId);

    const membershipSnapshot = await getDoc(membershipRef);

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

    // =================================
    // C. SIMPAN HASIL VERIFIKASI
    // =================================

    currentStudent = {
      nim,
      name: studentName,
    };

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

    console.log("Verifikasi mahasiswa berhasil:", nim);
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

  isSubmitting = true;

  submitButton.disabled = true;
  checkButton.disabled = true;
  nimInput.disabled = true;

  submitButton.textContent = "Menyimpan absensi...";

  try {
    // =================================
    // A. ID DOKUMEN ABSENSI
    // =================================

    const attendanceId = `${sessionId}_${currentStudent.nim}`;

    const attendanceRef = doc(db, "attendance", attendanceId);

    // =================================
    // B. DATA ABSENSI
    // =================================

    const attendanceData = {
      sessionId: sessionId,

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

      token: token,

      createdAt: serverTimestamp(),
    };

    // =================================
    // C. SIMPAN ABSENSI
    // =================================

    await setDoc(attendanceRef, attendanceData);

    console.log("Absensi berhasil disimpan.");

    // =================================
    // D. TAMPILKAN SUKSES
    // =================================

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
        "Absensi ditolak oleh Firestore Rules. Periksa autentikasi, token, sesi, dan aturan penyimpanan absensi.",
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
      !currentStudent || !currentMembership || !isSessionValid(currentSession);
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
