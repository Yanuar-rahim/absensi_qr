import { auth, db, authPersistence } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ==================== ELEMENT ====================
const $ = (id) => document.getElementById(id);

const sessionTable = $("sessionTable");
const totalSessions = $("totalSessions");
const activeSessions = $("activeSessions");
const closedSessions = $("closedSessions");
const tableInfo = $("tableInfo");

const sessionModal = $("sessionModal");
const sessionForm = $("sessionForm");

const courseInput = $("courseInput");
const classInput = $("classInput");
const classInfo = $("classInfo");

const meetingInput = $("meetingInput");
const dateInput = $("dateInput");
const timeInput = $("timeInput");
const durationInput = $("durationInput");

const formError = $("formError");
const saveButton = $("saveButton");
const searchInput = $("searchInput");

const qrModal = $("qrModal");
const qrCode = $("qrCode");
const qrStatus = $("qrStatus");
const qrCountdown = $("qrCountdown");
const qrProgress = $("qrProgress");

let courses = [];
let courseClasses = [];
let sessions = [];
let toastTimer;

// ==================== SIDEBAR ====================
const sidebar = $("sidebar");
const overlay = $("overlay");

$("openSidebar").addEventListener("click", () => {
  sidebar.classList.add("show");
  overlay.classList.remove("hidden");
});

function closeSidebar() {
  sidebar.classList.remove("show");
  overlay.classList.add("hidden");
}

$("closeSidebar").addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);

// ==================== TOAST ====================
function showToast(message, type = "success") {
  clearTimeout(toastTimer);

  const toast = $("toast");
  toast.textContent = message;

  toast.className =
    "fixed bottom-5 right-5 z-[90] max-w-sm rounded-xl px-5 py-4 text-sm font-medium text-white shadow-xl " +
    (type === "success" ? "bg-emerald-600" : "bg-red-600");

  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

// ==================== HELPER ====================
function escapeHTML(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
}

// Format tanggal dan waktu WITA
function formatDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return "-";

  const date = timestamp.toDate();
  if (Number.isNaN(date.getTime())) return "-";

  const dateText = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(date);

  const timeText = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Makassar",
  }).format(date);

  return `${dateText} • ${timeText} WITA`;
}

function getSessionStatus(session) {
  if (session.status !== "active") return "closed";

  const now = Date.now();
  const startsAt = session.startsAt?.toDate?.().getTime() ?? 0;
  const expiresAt = session.expiresAt?.toDate?.().getTime() ?? 0;

  if (now < startsAt) return "scheduled";
  if (now > expiresAt) return "expired";

  return "active";
}

// Token acak: 16 byte = 32 karakter hex
function generateToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ==================== LOAD DATA ====================
async function loadCourses() {
  const snapshot = await getDocs(collection(db, "courses"));

  courses = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

  courses.sort((a, b) =>
    String(a.name || a.courseName || "").localeCompare(
      String(b.name || b.courseName || ""),
      "id",
    ),
  );

  if (!courses.length) {
    courseInput.innerHTML = '<option value="">Belum ada mata kuliah</option>';
    return;
  }

  courseInput.innerHTML = `
    <option value="">Pilih Mata Kuliah</option>
    ${courses
      .map((course) => {
        const name = course.name || course.courseName || "Tanpa Nama";
        const code = course.code || course.courseCode || course.id;

        return `<option value="${escapeHTML(course.id)}">${escapeHTML(code)} - ${escapeHTML(name)}</option>`;
      })
      .join("")}
  `;
}

async function loadCourseClasses() {
  const snapshot = await getDocs(collection(db, "courseClasses"));

  courseClasses = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

function updateClassOptions() {
  const courseId = courseInput.value;

  classInput.innerHTML = "";
  classInput.disabled = true;

  if (!courseId) {
    classInput.innerHTML =
      '<option value="">Pilih mata kuliah terlebih dahulu</option>';
    classInfo.textContent =
      "Pilih mata kuliah untuk menampilkan kelas yang tersedia.";
    return;
  }

  const filteredClasses = courseClasses.filter(
    (item) => String(item.courseId || "") === String(courseId),
  );

  if (!filteredClasses.length) {
    classInput.innerHTML =
      '<option value="">Belum ada kelas untuk mata kuliah ini</option>';
    classInfo.textContent =
      "Tambahkan kelas pada menu pengelolaan kelas terlebih dahulu.";
    return;
  }

  filteredClasses.sort((a, b) =>
    String(a.className || "").localeCompare(String(b.className || ""), "id"),
  );

  classInput.innerHTML = `
    <option value="">Pilih Kelas</option>
    ${filteredClasses
      .map(
        (item) =>
          `<option value="${escapeHTML(item.id)}">${escapeHTML(item.className || item.name || item.id)}</option>`,
      )
      .join("")}
  `;

  classInput.disabled = false;
  classInfo.textContent = `${filteredClasses.length} kelas tersedia untuk mata kuliah ini.`;
}

courseInput.addEventListener("change", updateClassOptions);

async function loadSessions() {
  sessionTable.innerHTML = `
    <tr>
      <td colspan="8" class="px-5 py-12 text-center text-sm text-slate-400">Memuat sesi absensi...</td>
    </tr>
  `;

  try {
    const snapshot = await getDocs(collection(db, "sessions"));

    sessions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

    sessions.sort((a, b) => {
      const first = a.startsAt?.toDate?.().getTime() || 0;
      const second = b.startsAt?.toDate?.().getTime() || 0;
      return second - first;
    });

    renderSessions();
  } catch (error) {
    console.error("Load sessions error:", error);

    sessionTable.innerHTML = `
      <tr>
        <td colspan="8" class="px-5 py-12 text-center text-sm text-red-500">
          Gagal mengambil data sesi. Periksa Firestore Rules.
        </td>
      </tr>
    `;

    showToast("Gagal memuat sesi absensi.", "error");
  }
}

// ==================== RENDER TABLE ====================
function renderSessions() {
  const keyword = searchInput.value.trim().toLowerCase();

  const filtered = sessions.filter((session) => {
    const courseName = String(session.courseName || "").toLowerCase();
    const courseCode = String(session.courseCode || "").toLowerCase();
    const className = String(session.className || "").toLowerCase();

    return (
      courseName.includes(keyword) ||
      courseCode.includes(keyword) ||
      className.includes(keyword)
    );
  });

  const statuses = sessions.map(getSessionStatus);

  totalSessions.textContent = sessions.length;
  activeSessions.textContent = statuses.filter((s) => s === "active").length;
  closedSessions.textContent = statuses.filter((s) => s !== "active").length;
  tableInfo.textContent = `Menampilkan ${filtered.length} dari ${sessions.length} sesi`;

  if (!filtered.length) {
    sessionTable.innerHTML = `
      <tr>
        <td colspan="8" class="px-5 py-12 text-center text-sm text-slate-400">
          ${keyword ? "Sesi tidak ditemukan." : "Belum ada sesi absensi. Silakan buat sesi baru."}
        </td>
      </tr>
    `;
    return;
  }

  const statusLabels = {
    active: "Berlangsung",
    closed: "Ditutup",
    expired: "Kedaluwarsa",
    scheduled: "Terjadwal",
  };

  const statusClasses = {
    active: "bg-emerald-50 text-emerald-700",
    closed: "bg-slate-100 text-slate-600",
    expired: "bg-red-50 text-red-600",
    scheduled: "bg-amber-50 text-amber-700",
  };

  sessionTable.innerHTML = filtered
    .map((session, index) => {
      const status = getSessionStatus(session);

      return `
        <tr class="border-t border-slate-100 transition hover:bg-slate-50">
          <td class="px-5 py-4 text-sm text-slate-500">${index + 1}</td>

          <td class="px-5 py-4">
            <p class="text-sm font-semibold text-slate-700">${escapeHTML(session.courseName || "-")}</p>
            <p class="mt-1 text-xs text-slate-400">${escapeHTML(session.courseCode || "")}</p>
          </td>

          <td class="px-5 py-4">
            <p class="text-sm font-semibold text-slate-700">${escapeHTML(session.className || "-")}</p>
            <p class="mt-1 text-xs text-slate-400">${escapeHTML(session.lecturerName || "")}</p>
          </td>

          <td class="px-5 py-4 text-sm text-slate-600">Pertemuan ${escapeHTML(session.meeting || "-")}</td>
          <td class="px-5 py-4 text-sm text-slate-500">${formatDate(session.startsAt)}</td>
          <td class="px-5 py-4 text-sm text-slate-500">${formatDate(session.expiresAt)}</td>

          <td class="px-5 py-4">
            <span class="rounded-full px-3 py-1.5 text-xs font-semibold ${statusClasses[status]}">
              ${statusLabels[status]}
            </span>
          </td>

          <td class="px-5 py-4">
            <div class="flex items-center justify-center gap-2">
              <button data-qr="${escapeHTML(session.id)}" class="rounded-lg bg-blue-50 p-2 text-blue-600 hover:bg-blue-100" title="Lihat QR Code">
                <i data-lucide="qr-code" class="h-4 w-4"></i>
              </button>

              ${
                status === "active" || status === "scheduled"
                  ? `<button data-close="${escapeHTML(session.id)}" class="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100" title="Tutup sesi">
                       <i data-lucide="lock" class="h-4 w-4"></i>
                     </button>`
                  : ""
              }
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  lucide.createIcons();
}

searchInput.addEventListener("input", renderSessions);

// ==================== MODAL BUAT SESI ====================
function setDefaultDateTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);

  dateInput.value = local.toISOString().slice(0, 10);
  timeInput.value = local.toISOString().slice(11, 16);
}

function openModal() {
  sessionModal.classList.remove("hidden");
  sessionModal.classList.add("flex");
}

function closeModal() {
  sessionModal.classList.add("hidden");
  sessionModal.classList.remove("flex");

  sessionForm.reset();

  formError.classList.add("hidden");
  formError.textContent = "";

  updateClassOptions();
  setDefaultDateTime();
}

function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

$("addButton").addEventListener("click", () => {
  sessionForm.reset();
  formError.classList.add("hidden");

  updateClassOptions();
  setDefaultDateTime();
  openModal();
});

$("closeModal").addEventListener("click", closeModal);
$("cancelButton").addEventListener("click", closeModal);

// ==================== BUAT SESI ====================
sessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  formError.classList.add("hidden");
  formError.textContent = "";

  const courseId = courseInput.value;
  const classId = classInput.value;
  const meeting = Number(meetingInput.value);
  const date = dateInput.value;
  const time = timeInput.value;
  const duration = Number(durationInput.value);

  const course = courses.find((item) => item.id === courseId);
  const selectedClass = courseClasses.find((item) => item.id === classId);

  if (!course) {
    showFormError("Pilih mata kuliah terlebih dahulu.");
    return;
  }

  if (
    !selectedClass ||
    String(selectedClass.courseId || "") !== String(courseId)
  ) {
    showFormError("Pilih kelas yang sesuai dengan mata kuliah.");
    return;
  }

  if (!meeting || meeting < 1 || meeting > 30 || !date || !time || !duration) {
    showFormError("Lengkapi semua informasi sesi dengan benar.");
    return;
  }

  const courseName = course.name || course.courseName || "";
  const courseCode = course.code || course.courseCode || course.id;
  const className = selectedClass.className || selectedClass.name || "";
  const lecturerName = selectedClass.lecturerName || "";

  if (!className) {
    showFormError("Nama kelas tidak ditemukan pada data kelas.");
    return;
  }

  const startsAtDate = new Date(`${date}T${time}:00`);
  const expiresAtDate = new Date(startsAtDate.getTime() + duration * 60000);

  if (Number.isNaN(startsAtDate.getTime())) {
    showFormError("Tanggal atau waktu tidak valid.");
    return;
  }

  if (expiresAtDate.getTime() <= Date.now()) {
    showFormError("Waktu akhir sesi sudah lewat. Pilih waktu mendatang.");
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Membuat sesi...";

  try {
    if (!auth.currentUser) {
      throw new Error(
        "Sesi administrator tidak ditemukan. Silakan login kembali.",
      );
    }

    // ID sesi acak; token QR dinamis dibuat terpisah saat QR ditampilkan
    const sessionId = generateToken();
    const sessionRef = doc(db, "sessions", sessionId);

    const sessionData = {
      courseId: course.id,
      courseCode,
      courseName,

      classId: selectedClass.id,
      className,
      lecturerName,

      meeting,
      date,
      duration,

      startsAt: Timestamp.fromDate(startsAtDate),
      expiresAt: Timestamp.fromDate(expiresAtDate),

      status: "active",

      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid,
    };

    await setDoc(sessionRef, sessionData);

    sessions = sessions.filter((item) => item.id !== sessionRef.id);
    sessions.unshift({ id: sessionRef.id, ...sessionData });

    renderSessions();
    closeModal();

    showToast("Sesi absensi berhasil dibuat.");

    try {
      await showQr(sessionRef.id);
    } catch (qrError) {
      console.error("Generate QR error:", qrError);

      showToast(
        "Sesi berhasil disimpan, tetapi QR gagal dibuat: " + qrError.message,
        "error",
      );
    }
  } catch (error) {
    console.error("Create session error:", error);

    if (error.code === "permission-denied") {
      showFormError("Akses ditolak. Periksa Firestore Rules.");
    } else {
      showFormError(error.message || "Gagal membuat sesi absensi.");
    }

    showToast("Gagal membuat sesi absensi.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Buat Sesi dan QR";
  }
});

// ==================== QR DINAMIS ====================
const QR_REFRESH_SECONDS = 45; // QR berganti setiap 45 detik
const QR_TOKEN_LIFETIME_SECONDS = 60; // token lama masih valid 1 menit

let qrInstance = null;
let qrTimer = null;
let qrRunId = 0;
let qrRotating = false;
let qrNextRefreshAt = 0;
let qrActiveSessionId = null;

function setQrStatus(message, type = "ok") {
  qrStatus.textContent = message;
  qrStatus.className =
    "font-medium " + (type === "ok" ? "text-emerald-600" : "text-red-600");
}

function buildScanUrl(sessionId, dynamicToken) {
  const scanUrl = new URL("../mahasiswa/scan.html", window.location.href);

  scanUrl.searchParams.set("sessionId", sessionId);
  scanUrl.searchParams.set("t", dynamicToken);

  return scanUrl.href;
}

// Buat token baru, simpan ke Firestore, lalu gambar ulang QR
async function rotateQrToken(session, runId) {
  const dynamicToken = generateToken();

  await setDoc(doc(db, "sessions", session.id, "qrTokens", dynamicToken), {
    token: dynamicToken,
    sessionId: session.id,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(
      Date.now() + QR_TOKEN_LIFETIME_SECONDS * 1000,
    ),
    createdBy: auth.currentUser.uid,
  });

  // Modal sudah ditutup / QR sesi lain dibuka saat menunggu Firestore
  if (runId !== qrRunId) return;

  const url = buildScanUrl(session.id, dynamicToken);

  if (!qrInstance) {
    qrCode.innerHTML = "";

    qrInstance = new QRCode(qrCode, {
      text: url,
      width: 230,
      height: 230,
      typeNumber: 0,
      colorDark: "#0f172a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L,
    });
  } else {
    qrInstance.clear();
    qrInstance.makeCode(url);
  }

  qrNextRefreshAt = Date.now() + QR_REFRESH_SECONDS * 1000;
  setQrStatus("QR aktif");
}

async function refreshQr(runId) {
  if (qrRotating) return;

  const session = sessions.find((item) => item.id === qrActiveSessionId);
  if (!session) return;

  qrRotating = true;

  try {
    await rotateQrToken(session, runId);
  } catch (error) {
    console.error("Rotate QR token error:", error);

    if (runId === qrRunId) {
      setQrStatus("Gagal memperbarui QR, mencoba lagi...", "error");
      qrNextRefreshAt = Date.now() + 5000; // coba lagi 5 detik kemudian
    }
  } finally {
    qrRotating = false;
  }
}

function tickQr(runId) {
  if (runId !== qrRunId) return;

  const session = sessions.find((item) => item.id === qrActiveSessionId);
  const status = session ? getSessionStatus(session) : "closed";

  // Sesi ditutup / berakhir saat QR sedang tampil
  if (status === "closed" || status === "expired") {
    stopDynamicQr();
    qrCode.innerHTML =
      '<p class="text-sm text-slate-400">Sesi telah berakhir.</p>';
    setQrStatus("Sesi berakhir", "error");
    qrCountdown.textContent = "0";
    qrProgress.style.width = "0%";
    return;
  }

  const remainingMs = Math.max(0, qrNextRefreshAt - Date.now());

  qrCountdown.textContent = Math.ceil(remainingMs / 1000);
  qrProgress.style.width = `${(remainingMs / (QR_REFRESH_SECONDS * 1000)) * 100}%`;

  if (remainingMs === 0) refreshQr(runId);
}

function stopDynamicQr() {
  clearInterval(qrTimer);

  qrTimer = null;
  qrRunId++; // membatalkan proses async yang masih berjalan
  qrRotating = false;
  qrInstance = null;
  qrActiveSessionId = null;
}

async function startDynamicQr(session) {
  stopDynamicQr();

  const runId = qrRunId;

  qrActiveSessionId = session.id;
  qrCode.innerHTML = "";
  qrCountdown.textContent = "--";
  qrProgress.style.width = "100%";
  setQrStatus("Menyiapkan QR...");

  // Token pertama harus tersimpan dulu sebelum QR ditampilkan
  qrNextRefreshAt = 0;
  await refreshQr(runId);

  if (runId !== qrRunId) return;

  qrTimer = setInterval(() => tickQr(runId), 250);
}

async function showQr(sessionId) {
  const session = sessions.find((item) => item.id === sessionId);

  if (!session) {
    showToast("Data sesi tidak ditemukan.", "error");
    return;
  }

  const status = getSessionStatus(session);

  if (status === "closed" || status === "expired") {
    showToast("Sesi ini sudah tidak dapat digunakan.", "error");
    return;
  }

  if (typeof QRCode === "undefined") {
    throw new Error(
      "Library QRCode belum berhasil dimuat. Periksa koneksi CDN.",
    );
  }

  if (!auth.currentUser) {
    throw new Error("Sesi administrator tidak ditemukan. Silakan login ulang.");
  }

  $("qrCourseName").textContent = session.courseName || "Mata Kuliah";
  $("qrClassName").textContent = `Kelas ${session.className || "-"}`;
  $("qrLecturer").textContent = session.lecturerName
    ? `Dosen: ${session.lecturerName}`
    : "";
  $("qrMeeting").textContent = `Pertemuan ${session.meeting}`;
  $("qrExpiry").textContent =
    `Absensi berlaku sampai ${formatDate(session.expiresAt)}`;

  qrModal.classList.remove("hidden");
  qrModal.classList.add("flex");

  await startDynamicQr(session);
}

function closeQr() {
  stopDynamicQr();

  qrModal.classList.add("hidden");
  qrModal.classList.remove("flex");
  qrCode.innerHTML = "";
}

$("closeQrButton").addEventListener("click", closeQr);

// ==================== TUTUP SESI ====================
async function closeSession(sessionId) {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;

  if (
    !confirm(
      `Tutup sesi ${session.courseName}, kelas ${session.className || "-"}, pertemuan ${session.meeting}?`,
    )
  ) {
    return;
  }

  try {
    await updateDoc(doc(db, "sessions", sessionId), {
      status: "closed",
      closedAt: serverTimestamp(),
    });

    showToast("Sesi berhasil ditutup.");

    closeQr();

    await loadSessions();
  } catch (error) {
    console.error("Close session error:", error);
    showToast("Gagal menutup sesi.", "error");
  }
}

// ==================== AKSI TABEL ====================
sessionTable.addEventListener("click", (event) => {
  const qrButton = event.target.closest("[data-qr]");
  const closeButton = event.target.closest("[data-close]");

  if (qrButton) {
    showQr(qrButton.dataset.qr).catch((error) => {
      console.error("Show QR error:", error);
      showToast("QR gagal dibuat: " + error.message, "error");
    });
  }

  if (closeButton) {
    closeSession(closeButton.dataset.close);
  }
});

// ==================== AUTENTIKASI ====================
async function initializePage() {
  try {
    await authPersistence;
  } catch (error) {
    console.error("Persistence error:", error);
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("../login.html");
      return;
    }

    try {
      const adminSnapshot = await getDoc(doc(db, "admins", user.uid));

      if (!adminSnapshot.exists()) {
        await signOut(auth);
        window.location.replace("../login.html");
        return;
      }

      const adminData = adminSnapshot.data();

      if (adminData.role !== "admin" || adminData.status !== "active") {
        await signOut(auth);
        window.location.replace("../login.html");
        return;
      }

      $("adminName").textContent = adminData.name || "Administrator";

      await loadCourses();
      await loadCourseClasses();
      await loadSessions();
    } catch (error) {
      console.error("Authentication check error:", error);

      alert("Gagal memeriksa akses administrator.");

      await signOut(auth);
      window.location.replace("../login.html");
    }
  });
}

// ==================== LOGOUT ====================
$("logoutButton").addEventListener("click", async () => {
  if (!confirm("Apakah kamu yakin ingin keluar?")) return;

  try {
    await signOut(auth);
    window.location.replace("../login.html");
  } catch (error) {
    console.error("Logout error:", error);
    showToast("Gagal keluar dari akun.", "error");
  }
});

setDefaultDateTime();
initializePage();
