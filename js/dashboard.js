import { auth, db, authPersistence } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  getCountFromServer,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// =====================================
// ELEMENT HTML
// =====================================

const welcomeName = document.getElementById("welcomeName");
const adminNameTop = document.getElementById("adminNameTop");
const logoutButton = document.getElementById("logoutButton");

const totalStudents = document.getElementById("totalStudents");
const totalCourses = document.getElementById("totalCourses");
const totalSessions = document.getElementById("totalSessions");
const totalAttendanceToday = document.getElementById("totalAttendanceToday");

const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const openSidebar = document.getElementById("openSidebar");
const closeSidebar = document.getElementById("closeSidebar");

// =====================================
// FORMAT ANGKA
// =====================================

function formatNumber(number) {
  return Number(number).toLocaleString("id-ID");
}

// =====================================
// TANGGAL HARI INI
// Format YYYY-MM-DD
// =====================================

function getTodayDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// =====================================
// MENAMPILKAN ERROR STATISTIK
// =====================================

function handleStatisticError(element, name, error) {
  element.textContent = "--";

  console.error(`Gagal memuat ${name}:`, {
    code: error?.code,
    message: error?.message,
    error,
  });
}

// =====================================
// MENGAMBIL SATU STATISTIK
// =====================================

async function loadStatistic(element, name, firestoreQuery) {
  element.textContent = "Memuat...";

  try {
    const snapshot = await getCountFromServer(firestoreQuery);
    const count = snapshot.data().count;

    element.textContent = formatNumber(count);

    console.log(`${name} berhasil dimuat:`, count);

    return count;
  } catch (error) {
    handleStatisticError(element, name, error);
    return null;
  }
}

// =====================================
// MEMUAT SEMUA STATISTIK
// =====================================

async function loadDashboardStatistics() {
  console.log("Memulai pengambilan statistik dashboard...");

  const today = getTodayDate();

  const statistics = [
    loadStatistic(totalStudents, "Total mahasiswa", collection(db, "students")),

    loadStatistic(totalCourses, "Total mata kuliah", collection(db, "courses")),

    loadStatistic(
      totalSessions,
      "Total sesi absensi",
      collection(db, "sessions"),
    ),

    loadStatistic(
      totalAttendanceToday,
      "Kehadiran hari ini",
      query(collection(db, "attendance"), where("date", "==", today)),
    ),
  ];

  await Promise.all(statistics);

  console.log("Proses pemuatan statistik selesai.");
}

// =====================================
// SIDEBAR MOBILE
// =====================================

function showSidebar() {
  sidebar.classList.add("show");
  overlay.classList.remove("hidden");
}

function hideSidebar() {
  sidebar.classList.remove("show");
  overlay.classList.add("hidden");
}

openSidebar.addEventListener("click", showSidebar);
closeSidebar.addEventListener("click", hideSidebar);
overlay.addEventListener("click", hideSidebar);

// =====================================
// VALIDASI ADMINISTRATOR
// =====================================

async function verifyAdmin(user) {
  const adminRef = doc(db, "admins", user.uid);
  const adminSnapshot = await getDoc(adminRef);

  if (!adminSnapshot.exists()) {
    throw new Error("ADMIN_NOT_REGISTERED");
  }

  const adminData = adminSnapshot.data();

  if (adminData.role !== "admin" || adminData.status !== "active") {
    throw new Error("ADMIN_NOT_AUTHORIZED");
  }

  return adminData;
}

// =====================================
// MEMULAI DASHBOARD
// =====================================

async function initializeDashboard() {
  try {
    await authPersistence;
  } catch (error) {
    console.error("Authentication persistence error:", error);
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }

    console.log("Administrator login:", user.uid);

    // ---------------------------------
    // VERIFIKASI ADMIN
    // ---------------------------------

    let adminData;

    try {
      adminData = await verifyAdmin(user);
    } catch (error) {
      console.error("Verifikasi administrator gagal:", error);

      if (error.message === "ADMIN_NOT_REGISTERED") {
        alert("Akun administrator tidak terdaftar.");
        await signOut(auth);
        window.location.replace("login.html");
        return;
      }

      if (error.message === "ADMIN_NOT_AUTHORIZED") {
        alert("Akses administrator tidak diizinkan.");
        await signOut(auth);
        window.location.replace("login.html");
        return;
      }

      if (error.code === "permission-denied") {
        alert(
          "Tidak dapat membaca data administrator. Periksa Firestore Rules.",
        );
      } else if (error.code === "resource-exhausted") {
        alert(
          "Kuota penggunaan Firebase telah tercapai. Coba kembali setelah kuota tersedia.",
        );
      } else {
        alert("Gagal memverifikasi administrator. Periksa koneksi Firebase.");
      }

      return;
    }

    // ---------------------------------
    // MENAMPILKAN NAMA ADMIN
    // ---------------------------------

    const displayName = adminData.name || "Administrator";

    welcomeName.textContent = displayName;
    adminNameTop.textContent = displayName;

    // ---------------------------------
    // MEMUAT STATISTIK
    // ---------------------------------

    await loadDashboardStatistics();
  });
}

// =====================================
// LOGOUT
// =====================================

logoutButton.addEventListener("click", async () => {
  const confirmation = confirm("Apakah kamu yakin ingin keluar?");

  if (!confirmation) return;

  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    console.error("Logout error:", error);
    alert("Gagal keluar dari akun.");
  }
});

// =====================================
// START
// =====================================

initializeDashboard();
