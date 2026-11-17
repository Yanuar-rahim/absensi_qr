// =====================================
// FIREBASE IMPORT
// =====================================

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
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// =====================================
// ELEMENTS
// =====================================

const attendanceTable = document.getElementById("attendanceTable");
const courseFilter = document.getElementById("courseFilter");
const classFilter = document.getElementById("classFilter");
const meetingFilter = document.getElementById("meetingFilter");
const startDate = document.getElementById("startDate");
const endDate = document.getElementById("endDate");
const searchInput = document.getElementById("searchInput");
const notification = document.getElementById("notification");

// =====================================
// VARIABLES
// =====================================

let allAttendance = [];
let filteredAttendance = [];
let allCourses = [];
let allClasses = [];
let allClassMembers = [];

let classNameMap = new Map();
let membershipMap = new Map();

let pageInitialized = false;

// =====================================
// KOP SURAT (dipakai oleh PDF dan Excel)
// =====================================

const KOP = {
  institution: "UNIVERSITAS DAYANU IKHSANUDDIN",
  unit: "LABORATORIUM TEKNIK INFORMATIKA",
  address: "Jalan Dayanu Ikhsanuddin No. 124, Telp. (0402) 2821138 Baubau",
  // Boleh berupa path gambar ATAU data URL PNG ("data:image/png;base64,...")
  logo: "../assets/images/LOGO-UNIDAYAN.png",
};

const THEME = {
  primary: [37, 99, 235], // blue-600
  primaryDark: [29, 78, 216], // blue-700
  primaryLight: [239, 246, 255], // blue-50
  primaryBorder: [191, 219, 254], // blue-200
};

// =====================================
// NOTIFICATION
// =====================================

function showNotification(message, type = "error") {
  notification.className = "mb-6 rounded-xl border p-4 text-sm";

  if (type === "success") {
    notification.classList.add(
      "border-blue-100",
      "bg-blue-50",
      "text-blue-700",
    );
  } else {
    notification.classList.add("border-red-100", "bg-red-50", "text-red-700");
  }

  notification.textContent = message;
  notification.classList.remove("hidden");

  // Pastikan pesan terlihat walaupun halaman sedang di-scroll
  notification.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideNotification() {
  notification.classList.add("hidden");
}

// =====================================
// FORMAT TANGGAL
// =====================================

function formatDate(dateString) {
  if (!dateString) return "-";

  const value = String(dateString);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return value;
    }

    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function getTodayString() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// =====================================
// AMBIL WAKTU ABSENSI
// =====================================

function getAttendanceDate(item) {
  const value =
    item.createdAt ??
    item.timestamp ??
    item.attendedAt ??
    item.scannedAt ??
    item.date ??
    null;

  if (!value) return null;

  // Firestore Timestamp
  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  // JavaScript Date
  if (value instanceof Date) {
    return value;
  }

  // Unix timestamp
  if (typeof value === "number") {
    // Mendukung Unix timestamp dalam detik maupun milidetik
    const timestamp = value < 1000000000000 ? value * 1000 : value;
    const date = new Date(timestamp);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  // String tanggal / waktu
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Object timestamp {seconds, nanoseconds}
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  return null;
}

// =====================================
// FORMAT WAKTU DENGAN TITIK TENGAH + WITA
// =====================================

function formatDateTime(item) {
  const date = getAttendanceDate(item);

  if (!date || Number.isNaN(date.getTime())) {
    return "-";
  }

  const formattedDate = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(date);

  const formattedTime = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Makassar",
  }).format(date);

  return `${formattedDate} • ${formattedTime} WITA`;
}

// =====================================
// FILTER TANGGAL MENGGUNAKAN FIELD DATE
// =====================================

function getAttendanceDateString(item) {
  if (item.date) {
    if (typeof item.date === "string") {
      return item.date.substring(0, 10);
    }

    if (typeof item.date.toDate === "function") {
      const date = item.date.toDate();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");

      return `${year}-${month}-${day}`;
    }
  }

  const date = getAttendanceDate(item);

  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// =====================================
// ADMIN AUTHENTICATION
// =====================================

async function checkAdmin(user) {
  if (!user) {
    window.location.replace("../login.html");
    return false;
  }

  const adminRef = doc(db, "admins", user.uid);
  const adminSnapshot = await getDoc(adminRef);

  if (!adminSnapshot.exists()) {
    await signOut(auth);
    window.location.replace("../login.html");
    return false;
  }

  const adminData = adminSnapshot.data();

  if (adminData.role !== "admin" || adminData.status !== "active") {
    await signOut(auth);
    window.location.replace("../login.html");
    return false;
  }

  document.getElementById("adminNameTop").textContent =
    adminData.name || "Administrator";

  return true;
}

// =====================================
// LOAD COURSE CLASSES
// =====================================

async function loadCourseClasses() {
  const snapshot = await getDocs(collection(db, "courseClasses"));

  allClasses = [];
  classNameMap.clear();

  snapshot.forEach((item) => {
    const data = item.data();

    const classItem = {
      id: item.id,
      courseId: data.courseId || "",
      courseCode: data.courseCode || "",
      courseName: data.courseName || "",
      className:
        data.className ||
        data.name ||
        data.class ||
        data.classCode ||
        "Kelas tanpa nama",
      lecturer: data.lecturer || data.lecturerName || data.dosenPengampu || "",
    };

    allClasses.push(classItem);
    classNameMap.set(item.id, classItem.className);
  });
}

// =====================================
// LOAD CLASS MEMBERS
// =====================================

async function loadClassMembers() {
  const snapshot = await getDocs(collection(db, "classMembers"));

  allClassMembers = [];
  membershipMap.clear();

  snapshot.forEach((item) => {
    const data = item.data();

    const member = {
      id: item.id,
      classId: data.classId || "",
      courseId: data.courseId || "",
      studentNim: data.studentNim || "",
      studentName: data.studentName || "",
      className:
        data.className ||
        classNameMap.get(data.classId) ||
        "Kelas belum diketahui",
    };

    allClassMembers.push(member);

    if (member.courseId && member.studentNim) {
      const key = `${member.courseId}_${member.studentNim}`;
      membershipMap.set(key, member);
    }
  });
}

// =====================================
// GET MEETING NUMBER
// =====================================

function getMeetingNumber(item) {
  const value =
    item.meetingNumber ??
    item.meeting ??
    item.meetingNo ??
    item.pertemuan ??
    "";

  return String(value).trim();
}

// =====================================
// NORMALISASI DATA ABSENSI
// =====================================

function normalizeAttendance(item) {
  const courseId = item.courseId || "";
  const studentNim = item.studentNim || "";

  let classId = item.classId || "";
  let className = item.className || "";

  if (classId && !className) {
    className = classNameMap.get(classId) || "";
  }

  if (!classId && courseId && studentNim) {
    const key = `${courseId}_${studentNim}`;
    const member = membershipMap.get(key);

    if (member) {
      classId = member.classId;
      className = member.className;
    }
  }

  if (!className && classId) {
    const member = allClassMembers.find(
      (m) => m.classId === classId && m.studentNim === studentNim,
    );

    if (member) {
      className = member.className;
    }
  }

  return {
    ...item,
    courseId,
    studentNim,
    classId,
    className: className || "Kelas belum tercatat",
  };
}

// =====================================
// LOAD ATTENDANCE
// =====================================

async function loadAttendance() {
  attendanceTable.innerHTML = `
    <tr>
      <td colspan="8" class="px-5 py-10 text-center text-slate-400">
        Memuat data kehadiran...
      </td>
    </tr>
  `;

  const snapshot = await getDocs(collection(db, "attendance"));

  allAttendance = [];

  snapshot.forEach((item) => {
    allAttendance.push({
      id: item.id,
      ...item.data(),
    });
  });

  allAttendance = allAttendance.map(normalizeAttendance);

  allAttendance.sort((a, b) => {
    const dateA = getAttendanceDate(a)?.getTime() || 0;
    const dateB = getAttendanceDate(b)?.getTime() || 0;

    if (dateA !== dateB) {
      return dateB - dateA;
    }

    return (a.studentName || "").localeCompare(b.studentName || "");
  });
}

// =====================================
// BUILD COURSE FILTER
// =====================================

function buildCourseFilter() {
  const courseMap = new Map();

  allAttendance.forEach((item) => {
    if (!item.courseId) return;

    if (!courseMap.has(item.courseId)) {
      courseMap.set(item.courseId, {
        id: item.courseId,
        code: item.courseCode || item.courseId,
        name: item.courseName || "Mata Kuliah tanpa nama",
      });
    }
  });

  allClasses.forEach((item) => {
    if (!item.courseId) return;
    if (courseMap.has(item.courseId)) return;

    courseMap.set(item.courseId, {
      id: item.courseId,
      code: item.courseCode || item.courseId,
      name: item.courseName || "Mata Kuliah tanpa nama",
    });
  });

  allCourses = Array.from(courseMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  courseFilter.innerHTML = `
    <option value="">Semua Mata Kuliah</option>
  `;

  allCourses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = `${course.code} - ${course.name}`;
    courseFilter.appendChild(option);
  });
}

// =====================================
// BUILD CLASS FILTER
// =====================================

function buildClassFilter() {
  const selectedCourse = courseFilter.value;

  classFilter.innerHTML = "";

  if (!selectedCourse) {
    classFilter.disabled = true;

    classFilter.innerHTML = `
      <option value="">Pilih mata kuliah terlebih dahulu</option>
    `;

    return;
  }

  classFilter.disabled = false;

  classFilter.innerHTML = `
    <option value="">Semua Kelas</option>
  `;

  const classMap = new Map();

  allClasses
    .filter((item) => item.courseId === selectedCourse)
    .forEach((item) => {
      classMap.set(item.id, {
        id: item.id,
        name: item.className,
      });
    });

  allAttendance
    .filter((item) => item.courseId === selectedCourse)
    .forEach((item) => {
      if (!item.classId) return;

      classMap.set(item.classId, {
        id: item.classId,
        name:
          item.className ||
          classNameMap.get(item.classId) ||
          "Kelas tanpa nama",
      });
    });

  const classes = Array.from(classMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  classes.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    classFilter.appendChild(option);
  });

  if (classes.length === 0) {
    classFilter.innerHTML = `
      <option value="">Belum ada kelas untuk mata kuliah ini</option>
    `;
  }
}

// =====================================
// BUILD MEETING FILTER
// =====================================

function buildMeetingFilter() {
  const selectedCourse = courseFilter.value;
  const selectedClass = classFilter.value;
  const previousValue = meetingFilter.value;

  meetingFilter.innerHTML = "";

  if (!selectedCourse) {
    meetingFilter.disabled = true;

    meetingFilter.innerHTML = `
      <option value="">Pilih mata kuliah terlebih dahulu</option>
    `;

    return;
  }

  let data = allAttendance.filter((item) => item.courseId === selectedCourse);

  if (selectedClass) {
    data = data.filter((item) => item.classId === selectedClass);
  }

  const meetings = [
    ...new Set(
      data
        .map((item) => getMeetingNumber(item))
        .filter((value) => value !== ""),
    ),
  ];

  meetings.sort((a, b) => {
    const numberA = Number(a);
    const numberB = Number(b);

    if (Number.isFinite(numberA) && Number.isFinite(numberB)) {
      return numberA - numberB;
    }

    return a.localeCompare(b, "id");
  });

  if (meetings.length === 0) {
    meetingFilter.disabled = true;

    meetingFilter.innerHTML = `
      <option value="">Belum ada pertemuan</option>
    `;

    return;
  }

  meetingFilter.disabled = false;

  meetingFilter.innerHTML = `
    <option value="">Semua Pertemuan</option>
  `;

  meetings.forEach((meeting) => {
    const option = document.createElement("option");

    option.value = meeting;
    option.textContent = `Pertemuan ${meeting}`;

    meetingFilter.appendChild(option);
  });

  if (meetings.includes(previousValue)) {
    meetingFilter.value = previousValue;
  }
}

// =====================================
// APPLY FILTERS
// =====================================

function applyFilters() {
  hideNotification();

  const selectedCourse = courseFilter.value;
  const selectedClass = classFilter.value;
  const selectedMeeting = meetingFilter.value;

  const fromDate = startDate.value;
  const toDate = endDate.value;
  const keyword = searchInput.value.trim().toLowerCase();

  if (fromDate && toDate && fromDate > toDate) {
    filteredAttendance = [];

    renderTable();
    updateStatistics();
    updateReportInfo();

    showNotification("Tanggal mulai tidak boleh melewati tanggal akhir.");

    return;
  }

  filteredAttendance = allAttendance.filter((item) => {
    const itemDate = getAttendanceDateString(item);

    const matchesCourse = !selectedCourse || item.courseId === selectedCourse;

    const matchesClass = !selectedClass || item.classId === selectedClass;

    const matchesMeeting =
      !selectedMeeting || getMeetingNumber(item) === selectedMeeting;

    const matchesStart = !fromDate || itemDate >= fromDate;

    const matchesEnd = !toDate || itemDate <= toDate;

    const matchesSearch =
      !keyword ||
      (item.studentName || "").toLowerCase().includes(keyword) ||
      (item.studentNim || "").toLowerCase().includes(keyword) ||
      (item.courseName || "").toLowerCase().includes(keyword) ||
      (item.courseCode || "").toLowerCase().includes(keyword) ||
      (item.className || "").toLowerCase().includes(keyword);

    return (
      matchesCourse &&
      matchesClass &&
      matchesMeeting &&
      matchesStart &&
      matchesEnd &&
      matchesSearch
    );
  });

  renderTable();
  updateStatistics();
  updateReportInfo();
}

// =====================================
// REPORT INFO
// =====================================

function updateReportInfo() {
  const course = allCourses.find((item) => item.id === courseFilter.value);

  const selectedClass = allClasses.find(
    (item) => item.id === classFilter.value,
  );

  const parts = [];

  if (course) {
    parts.push(course.name);
  }

  if (selectedClass) {
    parts.push(selectedClass.className);
  } else if (classFilter.value) {
    const attendanceClass = allAttendance.find(
      (item) => item.classId === classFilter.value,
    );

    parts.push(attendanceClass?.className || "Kelas terpilih");
  } else if (courseFilter.value) {
    parts.push("Semua kelas");
  }

  if (meetingFilter.value) {
    parts.push(`Pertemuan ${meetingFilter.value}`);
  } else if (courseFilter.value) {
    parts.push("Semua pertemuan");
  }

  document.getElementById("selectedReportInfo").textContent = parts.join(" • ");

  document.getElementById("resultInfo").textContent =
    `${filteredAttendance.length} data kehadiran ditemukan`;
}

// =====================================
// RENDER TABLE
// =====================================

function renderTable() {
  attendanceTable.innerHTML = "";

  const emptyState = document.getElementById("emptyState");

  emptyState.classList.toggle("hidden", filteredAttendance.length !== 0);

  if (filteredAttendance.length === 0) {
    attendanceTable.innerHTML = `
      <tr>
        <td colspan="8" class="px-5 py-8 text-center text-slate-400">
          Tidak ada data kehadiran.
        </td>
      </tr>
    `;

    return;
  }

  filteredAttendance.forEach((item, index) => {
    const row = document.createElement("tr");
    row.className = "transition hover:bg-slate-50";

    const meetingNumber = getMeetingNumber(item);

    const values = [
      index + 1,
      item.studentNim || "-",
      item.studentName || "-",
      item.courseName || "-",
      item.className || "-",
      meetingNumber ? `Pertemuan ${meetingNumber}` : "-",
      formatDateTime(item),
      item.status || "-",
    ];

    values.forEach((value, cellIndex) => {
      const cell = document.createElement("td");

      cell.className = "px-5 py-4 text-slate-600";

      if (cellIndex === 2) {
        cell.classList.add("font-semibold", "text-slate-800");
      }

      if (cellIndex === 4) {
        cell.classList.add("font-medium", "text-blue-700");
      }

      if (cellIndex === 6) {
        cell.classList.add("text-xs", "text-slate-600");
      }

      if (cellIndex === 7) {
        const badge = document.createElement("span");

        badge.className =
          "inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700";

        badge.textContent = String(value);

        cell.appendChild(badge);
      } else {
        cell.textContent = String(value);
      }

      row.appendChild(cell);
    });

    attendanceTable.appendChild(row);
  });
}

// =====================================
// STATISTICS
// =====================================

function updateStatistics() {
  document.getElementById("totalAttendance").textContent =
    filteredAttendance.length;

  const uniqueStudents = new Set(
    filteredAttendance.map((item) => item.studentNim),
  );

  document.getElementById("totalStudents").textContent = uniqueStudents.size;

  const uniqueMeetings = new Set(
    filteredAttendance.map((item) => {
      return [
        item.courseId,
        item.classId,
        getMeetingNumber(item),
        getAttendanceDateString(item),
      ].join("_");
    }),
  );

  document.getElementById("totalMeetings").textContent = uniqueMeetings.size;
}

// =====================================
// FILTER EVENTS
// =====================================

courseFilter.addEventListener("change", () => {
  buildClassFilter();
  buildMeetingFilter();
  applyFilters();
});

classFilter.addEventListener("change", () => {
  buildMeetingFilter();
  applyFilters();
});

meetingFilter.addEventListener("change", applyFilters);
startDate.addEventListener("change", applyFilters);
endDate.addEventListener("change", applyFilters);
searchInput.addEventListener("input", applyFilters);

// =====================================
// RESET FILTER
// =====================================

document.getElementById("resetButton").addEventListener("click", () => {
  courseFilter.value = "";

  buildClassFilter();
  buildMeetingFilter();

  startDate.value = "";
  endDate.value = "";
  searchInput.value = "";

  applyFilters();
});

// =====================================
// EXPORT INFORMATION
// =====================================

function getExportInformation() {
  const selectedCourse = allCourses.find(
    (item) => item.id === courseFilter.value,
  );

  const selectedClass =
    allClasses.find((item) => item.id === classFilter.value) ||
    allAttendance.find((item) => item.classId === classFilter.value);

  const selectedClassName =
    selectedClass?.className || selectedClass?.name || "";

  return {
    course: selectedCourse,
    classItem: selectedClass,

    courseName: selectedCourse?.name || "Semua Mata Kuliah",

    courseCode: selectedCourse?.code || "-",

    className: classFilter.value
      ? selectedClassName || "Kelas belum tercatat"
      : "Semua Kelas",

    meetingName: meetingFilter.value
      ? `Pertemuan ${meetingFilter.value}`
      : "Semua Pertemuan",

    meetingNumber: meetingFilter.value || "",

    dateRange:
      startDate.value || endDate.value
        ? `${startDate.value ? formatDate(startDate.value) : "Awal"} s.d. ${
            endDate.value ? formatDate(endDate.value) : "Sekarang"
          }`
        : "Semua Tanggal",

    searchKeyword: searchInput.value.trim(),

    totalAttendance: filteredAttendance.length,

    totalStudents: new Set(filteredAttendance.map((item) => item.studentNim))
      .size,

    totalMeetings: new Set(
      filteredAttendance.map((item) => {
        return [
          item.courseId,
          item.classId,
          getMeetingNumber(item),
          getAttendanceDateString(item),
        ].join("_");
      }),
    ).size,
  };
}

// =====================================
// EXPORT FILE NAME
// =====================================

function getExportFileName(extension) {
  const info = getExportInformation();

  const safeName = (value) =>
    String(value || "")
      .replace(/[\\/:*?"<>|]/g, "")
      .trim()
      .replace(/\s+/g, "_");

  let fileName = "Laporan_Absensi";

  if (info.course) {
    fileName += `_${safeName(info.course.name)}`;
  }

  if (classFilter.value) {
    fileName += `_${safeName(info.className)}`;
  }

  if (meetingFilter.value) {
    fileName += `_Pertemuan_${safeName(meetingFilter.value)}`;
  }

  if (startDate.value || endDate.value) {
    fileName += `_${safeName(startDate.value || "awal")}_sd_${safeName(
      endDate.value || "sekarang",
    )}`;
  }

  return `${fileName}_${getTodayString()}.${extension}`;
}

// =====================================
// DATA EXPORT
// =====================================

function getExportRows() {
  return filteredAttendance.map((item, index) => {
    const meetingNumber = getMeetingNumber(item);

    return {
      no: index + 1,
      nim: item.studentNim || "-",
      nama: item.studentName || "-",
      kode: item.courseCode || "-",
      mataKuliah: item.courseName || "-",
      kelas: item.className || "Kelas belum tercatat",
      pertemuan: meetingNumber ? `Pertemuan ${meetingNumber}` : "-",
      waktu: formatDateTime(item),
      status: item.status || "-",
    };
  });
}

// =====================================
// LOAD LIBRARY (dipakai Excel dan PDF)
// =====================================

function loadScript(src, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = src;
    script.async = false;

    const timer = setTimeout(() => {
      script.remove();
      reject(new Error("Waktu pemuatan library habis: " + src));
    }, timeout);

    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };

    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error("Gagal memuat library: " + src));
    };

    document.head.appendChild(script);
  });
}

async function loadFirstAvailable(urls, validator, libraryName) {
  let lastError = null;

  for (const url of urls) {
    try {
      await loadScript(url);

      if (validator()) {
        return true;
      }
    } catch (error) {
      console.warn(error.message);
      lastError = error;
    }
  }

  throw new Error(
    `${libraryName} gagal dimuat. ${
      lastError?.message || "Periksa koneksi internet."
    }`,
  );
}

// =====================================
// LOAD EXCELJS (otomatis jika belum ada)
// =====================================

async function loadExcelLibrary() {
  if (window.ExcelJS) return window.ExcelJS;

  await loadFirstAvailable(
    [
      "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
      "https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",
    ],
    () => !!window.ExcelJS,
    "ExcelJS",
  );

  return window.ExcelJS;
}

// =====================================
// LOGO -> DATA URL (dipakai Excel dan PDF)
// =====================================

let logoDataUrlPromise = null;

function getLogoDataUrl() {
  if (!KOP.logo) return Promise.resolve(null);

  if (!logoDataUrlPromise) {
    logoDataUrlPromise = (async () => {
      try {
        if (KOP.logo.startsWith("data:image/")) {
          return KOP.logo;
        }

        const response = await fetch(KOP.logo);

        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        const blob = await response.blob();

        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch (error) {
        console.warn(
          "Logo tidak dapat dimuat, laporan dibuat tanpa logo:",
          error,
        );
        return null;
      }
    })();
  }

  return logoDataUrlPromise;
}

// =====================================
// EXPORT EXCEL (ExcelJS)
// =====================================

document
  .getElementById("exportButton")
  .addEventListener("click", async function () {
    const button = this;

    if (filteredAttendance.length === 0) {
      showNotification("Tidak ada data kehadiran untuk diekspor.");
      return;
    }

    const originalContent = button.innerHTML;

    try {
      button.disabled = true;
      button.innerHTML = `<span class="animate-pulse">Menyiapkan Excel...</span>`;
      hideNotification();

      const ExcelJS = await loadExcelLibrary();
      const logoDataUrl = await getLogoDataUrl();

      const info = getExportInformation();
      const rows = getExportRows();

      const C = {
        primary: "FF2563EB", // blue-600
        primaryDark: "FF1D4ED8", // blue-700
        primaryLight: "FFEFF6FF", // blue-50
        primaryBorder: "FFBFDBFE", // blue-200
        text: "FF334155",
        gray: "FF64748B",
        white: "FFFFFFFF",
      };

      const TOTAL_COLS = 9;
      const font = (opts = {}) => ({
        name: "Calibri",
        size: 10,
        color: { argb: C.text },
        ...opts,
      });

      const workbook = new ExcelJS.Workbook();
      workbook.creator = KOP.unit;
      workbook.created = new Date();

      const ws = workbook.addWorksheet("Laporan Absensi", {
        views: [{ showGridLines: false }],
        pageSetup: {
          paperSize: 9,
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          horizontalCentered: true,
        },
      });

      [6, 18, 30, 16, 30, 20, 16, 46, 14].forEach((width, i) => {
        ws.getColumn(i + 1).width = width;
      });

      // Helper: gabung sel + isi + style
      const mergedCell = (row, c1, c2, value, style = {}) => {
        if (c2 > c1) ws.mergeCells(row, c1, row, c2);
        const cell = ws.getCell(row, c1);
        cell.value = value;
        cell.font = style.font || font();
        cell.alignment = style.alignment || {
          vertical: "middle",
          horizontal: "left",
          wrapText: true,
        };
        return cell;
      };

      let r = 1;

      // ---------- KOP SURAT ----------
      const kopLines = [
        {
          text: KOP.institution,
          size: 15,
          bold: true,
          color: C.primaryDark,
          h: 24,
        },
        { text: KOP.unit, size: 13, bold: true, color: C.primaryDark, h: 22 },
        { text: KOP.address, size: 9, bold: false, color: C.gray, h: 15 },
      ].filter((line) => line.text);

      const kopStartRow = r;

      kopLines.forEach((line) => {
        mergedCell(r, 1, TOTAL_COLS, line.text, {
          font: font({
            size: line.size,
            bold: line.bold,
            color: { argb: line.color },
          }),
          alignment: { vertical: "middle", horizontal: "center" },
        });
        ws.getRow(r).height = line.h;
        r++;
      });

      // Logo (opsional, dilewati jika gagal dimuat)
      if (logoDataUrl) {
        try {
          const imageId = workbook.addImage({
            base64: logoDataUrl,
            extension: "png",
          });
          ws.addImage(imageId, {
            tl: { col: 0.2, row: kopStartRow - 1 + 0.05 },
            ext: { width: 70, height: 70 },
          });
        } catch (e) {
          console.warn("Logo gagal ditambahkan:", e);
        }
      }

      // Garis pemisah kop (tebal biru)
      ws.getRow(r).height = 4;
      for (let c = 1; c <= TOTAL_COLS; c++) {
        ws.getCell(r, c).border = {
          bottom: { style: "thick", color: { argb: C.primary } },
        };
      }
      r++;

      ws.getRow(r).height = 10;
      r++;

      // ---------- JUDUL ----------
      mergedCell(r, 1, TOTAL_COLS, "LAPORAN ABSENSI MAHASISWA", {
        font: font({ size: 14, bold: true, color: { argb: C.primaryDark } }),
        alignment: { vertical: "middle", horizontal: "center" },
      });
      ws.getRow(r).height = 28;
      r++;

      ws.getRow(r).height = 8;
      r++;

      // ---------- INFO LAPORAN ----------
      const leftInfo = [
        ["Mata Kuliah", info.courseName],
        ["Kode Mata Kuliah", info.courseCode],
        ["Kelas", info.className],
        ["Pertemuan", info.meetingName],
      ];

      if (info.searchKeyword) {
        leftInfo.push(["Pencarian", info.searchKeyword]);
      }

      const rightInfo = [
        ["Total Kehadiran", info.totalAttendance],
        ["Mahasiswa Hadir", info.totalStudents],
        ["Total Pertemuan", info.totalMeetings],
        ["Tanggal Dikeluarkan", formatDate(getTodayString())],
      ];

      const infoCount = Math.max(leftInfo.length, rightInfo.length);

      for (let i = 0; i < infoCount; i++) {
        if (leftInfo[i]) {
          mergedCell(r, 1, 2, leftInfo[i][0], {
            font: font({ bold: true, color: { argb: C.primaryDark } }),
          });
          mergedCell(r, 3, 5, `: ${leftInfo[i][1]}`);
        }

        if (rightInfo[i]) {
          mergedCell(r, 6, 7, rightInfo[i][0], {
            font: font({ bold: true, color: { argb: C.primaryDark } }),
            alignment: { vertical: "middle", horizontal: "right" },
          });
          mergedCell(r, 8, 9, `: ${rightInfo[i][1]}`);
        }

        ws.getRow(r).height = 18;
        r++;
      }

      ws.getRow(r).height = 10;
      r++;

      // ---------- HEADER TABEL (BIRU) ----------
      const headerRow = r;
      const headers = [
        "No",
        "NIM",
        "Nama Mahasiswa",
        "Kode MK",
        "Mata Kuliah",
        "Kelas",
        "Pertemuan",
        "Waktu Absensi",
        "Status",
      ];

      const borderSide = { style: "thin", color: { argb: C.primaryBorder } };
      const fullBorder = {
        top: borderSide,
        left: borderSide,
        bottom: borderSide,
        right: borderSide,
      };

      headers.forEach((title, i) => {
        const cell = ws.getCell(headerRow, i + 1);
        cell.value = title;
        cell.font = font({ bold: true, size: 10.5, color: { argb: C.white } });
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: C.primary },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        };
        cell.border = {
          top: { style: "thin", color: { argb: C.primaryDark } },
          left: { style: "thin", color: { argb: C.primaryDark } },
          bottom: { style: "thin", color: { argb: C.primaryDark } },
          right: { style: "thin", color: { argb: C.primaryDark } },
        };
      });
      ws.getRow(headerRow).height = 26;
      r++;

      // ---------- ISI TABEL ----------
      const centerCols = [1, 2, 4, 7, 9];

      rows.forEach((item, index) => {
        const values = [
          item.no,
          item.nim,
          item.nama,
          item.kode,
          item.mataKuliah,
          item.kelas,
          item.pertemuan,
          item.waktu,
          item.status,
        ];

        values.forEach((value, i) => {
          const colNumber = i + 1;
          const cell = ws.getCell(r, colNumber);

          cell.value = value;
          cell.font = font(
            colNumber === 3
              ? { bold: true }
              : colNumber === 9
                ? { bold: true, color: { argb: C.primaryDark } }
                : {},
          );
          cell.alignment = {
            vertical: "middle",
            horizontal: centerCols.includes(colNumber) ? "center" : "left",
            wrapText: true,
          };
          cell.border = fullBorder;

          if (index % 2 === 1) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: C.primaryLight },
            };
          }
        });

        ws.getRow(r).height = 20;
        r++;
      });

      // ---------- CATATAN BAWAH ----------
      ws.getRow(r).height = 10;
      r++;

      mergedCell(
        r,
        1,
        TOTAL_COLS,
        `Dokumen ini dibuat otomatis oleh Sistem Absensi QR pada ${formatDate(getTodayString())}.`,
        {
          font: font({ size: 9, italic: true, color: { argb: C.gray } }),
          alignment: {
            horizontal: "center",
            vertical: "middle",
          },
        },
      );

      // Filter otomatis & header berulang saat dicetak
      ws.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: headerRow + rows.length, column: TOTAL_COLS },
      };
      ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;

      // ---------- DOWNLOAD ----------
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = getExportFileName("xlsx");
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(fileUrl), 10000);

      showNotification(
        `Excel berhasil diekspor. ${info.totalAttendance} data kehadiran mahasiswa.`,
        "success",
      );
    } catch (error) {
      console.error("Export Excel error:", error);
      showNotification(
        "Gagal membuat file Excel: " + (error.message || "Terjadi kesalahan."),
      );
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;
      if (window.lucide) lucide.createIcons();
    }
  });

// =====================================
// LOAD PDF LIBRARY
// =====================================

async function loadPdfLibraries() {
  await loadFirstAvailable(
    [
      "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
      "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js",
    ],
    () => !!window.jspdf?.jsPDF,
    "jsPDF",
  );

  const jsPDF = window.jspdf.jsPDF;
  const testPdf = new jsPDF();

  if (typeof testPdf.autoTable !== "function") {
    await loadFirstAvailable(
      [
        "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
        "https://unpkg.com/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js",
      ],
      () => {
        const test = new jsPDF();
        return typeof test.autoTable === "function";
      },
      "jsPDF AutoTable",
    );
  }

  const finalTest = new jsPDF();

  if (typeof finalTest.autoTable !== "function") {
    throw new Error("Plugin AutoTable tidak terhubung dengan jsPDF.");
  }

  return jsPDF;
}

// =====================================
// EXPORT PDF
// =====================================

document
  .getElementById("exportPdfButton")
  .addEventListener("click", async function () {
    const button = this;

    if (filteredAttendance.length === 0) {
      showNotification("Tidak ada data kehadiran untuk diekspor.");
      return;
    }

    const originalContent = button.innerHTML;

    try {
      button.disabled = true;
      button.innerHTML = `
        <span class="animate-pulse">Menyiapkan PDF...</span>
      `;

      hideNotification();

      const jsPDF = await loadPdfLibraries();
      const logoDataUrl = await getLogoDataUrl();

      const info = getExportInformation();
      const rows = getExportRows();

      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const centerX = pageWidth / 2;
      const marginX = 14;
      const rightX = pageWidth - marginX;

      // ---------- KOP SURAT ----------
      if (logoDataUrl) {
        try {
          pdf.addImage(logoDataUrl, "PNG", marginX, 9, 22, 22);
        } catch (e) {
          console.warn("Logo gagal ditambahkan:", e);
        }
      }

      pdf.setTextColor(...THEME.primaryDark);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(15);
      pdf.text(KOP.institution, centerX, 15, { align: "center" });

      pdf.setFontSize(12);
      pdf.text(KOP.unit, centerX, 21, { align: "center" });

      pdf.setTextColor(100, 116, 139);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.text(KOP.address, centerX, 26.5, { align: "center" });

      // Garis kop: tebal biru + tipis
      pdf.setDrawColor(...THEME.primary);
      pdf.setLineWidth(1.2);
      pdf.line(marginX, 35, rightX, 35);
      pdf.setLineWidth(0.3);
      pdf.line(marginX, 36.8, rightX, 36.8);

      // ---------- JUDUL ----------
      pdf.setTextColor(...THEME.primaryDark);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text("LAPORAN ABSENSI MAHASISWA", centerX, 46, { align: "center" });

      // ---------- INFO LAPORAN ----------
      const leftInfo = [
        ["Mata Kuliah", info.courseName],
        ["Kode Mata Kuliah", info.courseCode],
        ["Kelas", info.className],
        ["Pertemuan", info.meetingName],
      ];

      if (info.searchKeyword) {
        leftInfo.push(["Pencarian", info.searchKeyword]);
      }

      const rightInfo = [
        ["Total Kehadiran", String(info.totalAttendance)],
        ["Mahasiswa Hadir", String(info.totalStudents)],
        ["Total Pertemuan", String(info.totalMeetings)],
        ["Tanggal Dikeluarkan", formatDate(getTodayString())],
      ];

      const infoY = 55;
      const lineGap = 6;

      pdf.setFontSize(9);

      leftInfo.forEach(([label, value], i) => {
        const y = infoY + i * lineGap;

        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...THEME.primaryDark);
        pdf.text(label, marginX, y);

        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(51, 65, 85);
        pdf.text(`: ${value}`, 48, y, { maxWidth: 140 });
      });

      rightInfo.forEach(([label, value], i) => {
        const y = infoY + i * lineGap;

        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...THEME.primaryDark);
        pdf.text(label, 200, y);

        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(51, 65, 85);
        pdf.text(`: ${value}`, 238, y);
      });

      const tableStartY =
        infoY + Math.max(leftInfo.length, rightInfo.length) * lineGap + 2;

      if (typeof pdf.autoTable !== "function") {
        throw new Error("Plugin AutoTable tidak tersedia.");
      }

      // ---------- TABEL ----------
      pdf.autoTable({
        startY: tableStartY,

        head: [
          [
            "No",
            "NIM",
            "Nama Mahasiswa",
            "Kode MK",
            "Mata Kuliah",
            "Kelas",
            "Pertemuan",
            "Waktu Absensi",
            "Status",
          ],
        ],

        body: rows.map((item) => [
          item.no,
          item.nim,
          item.nama,
          item.kode,
          item.mataKuliah,
          item.kelas,
          item.pertemuan,
          item.waktu,
          item.status,
        ]),

        theme: "grid",
        showHead: "everyPage",

        styles: {
          lineColor: THEME.primaryBorder,
          lineWidth: 0.2,
          valign: "middle",
        },

        headStyles: {
          fillColor: THEME.primary,
          textColor: [255, 255, 255],
          fontStyle: "bold",
          halign: "center",
          fontSize: 8.5,
          cellPadding: 3,
          lineColor: THEME.primaryDark,
        },

        bodyStyles: {
          fontSize: 7.5,
          cellPadding: 2.5,
          textColor: [51, 65, 85],
        },

        alternateRowStyles: {
          fillColor: THEME.primaryLight,
        },

        // Total lebar = 269 mm (selebar area cetak)
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          1: { cellWidth: 24, halign: "center" },
          2: { cellWidth: 44, fontStyle: "bold" },
          3: { cellWidth: 22, halign: "center" },
          4: { cellWidth: 44 },
          5: { cellWidth: 26 },
          6: { cellWidth: 24, halign: "center" },
          7: { cellWidth: 55 },
          8: {
            cellWidth: 20,
            halign: "center",
            fontStyle: "bold",
            textColor: THEME.primaryDark,
          },
        },

        margin: {
          left: marginX,
          right: marginX,
          bottom: 18,
        },
      });

      // ---------- FOOTER SETIAP HALAMAN ----------
      const totalPages = pdf.internal.getNumberOfPages();

      for (let page = 1; page <= totalPages; page++) {
        pdf.setPage(page);

        const pw = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        pdf.setDrawColor(...THEME.primary);
        pdf.setLineWidth(0.4);
        pdf.line(14, pageHeight - 12, pw - 14, pageHeight - 12);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(120, 120, 120);

        pdf.text(
          "Absensi QR - Laporan Kehadiran Mahasiswa",
          14,
          pageHeight - 8,
        );

        pdf.text(
          `Halaman ${page} dari ${totalPages}`,
          pw - 14,
          pageHeight - 8,
          {
            align: "right",
          },
        );
      }

      // ---------- DOWNLOAD ----------
      const blob = pdf.output("blob");

      if (!blob || blob.size === 0) {
        throw new Error("File PDF kosong atau gagal dibuat.");
      }

      const fileUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");

      downloadLink.href = fileUrl;
      downloadLink.download = getExportFileName("pdf");
      downloadLink.style.display = "none";

      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();

      setTimeout(() => {
        URL.revokeObjectURL(fileUrl);
      }, 10000);

      showNotification(
        `PDF berhasil dibuat. ${info.totalAttendance} data kehadiran mahasiswa.`,
        "success",
      );
    } catch (error) {
      console.error("Export PDF error:", error);

      showNotification(
        "Gagal mengekspor PDF: " + (error.message || "Terjadi kesalahan."),
      );
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;

      if (window.lucide) {
        lucide.createIcons();
      }
    }
  });

// =====================================
// LOGOUT
// =====================================

document.getElementById("logoutButton").addEventListener("click", async () => {
  const confirmation = confirm("Apakah kamu yakin ingin keluar?");

  if (!confirmation) return;

  try {
    await signOut(auth);
    window.location.replace("../login.html");
  } catch (error) {
    console.error(error);
    showNotification("Gagal keluar dari akun administrator.");
  }
});

// =====================================
// MOBILE SIDEBAR
// =====================================

const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");

function closeSidebar() {
  sidebar.classList.remove("show");
  overlay.classList.add("hidden");
}

document.getElementById("openSidebar").addEventListener("click", () => {
  sidebar.classList.add("show");
  overlay.classList.remove("hidden");
});

document.getElementById("closeSidebar").addEventListener("click", closeSidebar);

overlay.addEventListener("click", closeSidebar);

// =====================================
// INITIALIZATION
// =====================================

async function initializePage() {
  try {
    await authPersistence;

    onAuthStateChanged(auth, async (user) => {
      if (pageInitialized) return;

      try {
        const valid = await checkAdmin(user);

        if (!valid) return;

        pageInitialized = true;

        await loadCourseClasses();
        await loadClassMembers();
        await loadAttendance();

        buildCourseFilter();
        buildClassFilter();
        buildMeetingFilter();

        applyFilters();
      } catch (error) {
        console.error("Initialization error:", error);

        if (error.code === "permission-denied") {
          showNotification(
            "Akses Firestore ditolak. Periksa Firestore Rules untuk attendance, courseClasses, dan classMembers.",
          );
        } else {
          showNotification("Gagal memuat laporan: " + error.message);
        }
      }
    });
  } catch (error) {
    console.error(error);
    showNotification("Gagal menginisialisasi Firebase.");
  }
}

initializePage();
