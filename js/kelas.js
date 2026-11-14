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
  getCountFromServer,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const classModal = $("classModal");
const memberModal = $("memberModal");

let courses = [];
let classes = [];
let students = [];
let members = [];

let studentsLoaded = false;
let totalMemberCount = 0;

const loadedCourseMembers = new Set();
const loadedClassMembers = new Set();
const classMemberCounts = new Map();

let editingClassId = null;
let selectedClass = null;

let selectedNims = new Set();
let originalNims = new Set();

let expandedClassId = null;
let isSaving = false;
let toastTimeout = null;
let currentAdminUid = null;
let authInitialized = false;

// ======================================================
// AUTHENTICATION
// ======================================================

await authPersistence;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  if (authInitialized) return;
  authInitialized = true;

  try {
    currentAdminUid = user.uid;

    const adminSnap = await getDoc(doc(db, "admins", user.uid));

    if (
      !adminSnap.exists() ||
      adminSnap.data().role !== "admin" ||
      adminSnap.data().status !== "active"
    ) {
      alert("Akses administrator tidak diizinkan.");
      await signOut(auth);
      window.location.href = "../login.html";
      return;
    }

    $("adminName").textContent = adminSnap.data().name || "Administrator";

    await initializePage();
  } catch (error) {
    console.error("Pemeriksaan admin:", error);
    showToast("Gagal memeriksa akses administrator.", "error");
  }
});

// ======================================================
// INITIAL LOAD
// Hanya membaca courses, courseClasses, dan agregasi
// jumlah classMembers. Tidak membaca seluruh mahasiswa.
// ======================================================

async function initializePage() {
  $("classTableBody").innerHTML = loadingRow();

  await Promise.all([loadCourses(), loadClasses(), loadTotalMemberCount()]);

  renderCourseOptions();
  renderCourseFilter();
  renderClasses();
  updateStatistics();
}

async function loadCourses() {
  const snapshot = await getDocs(collection(db, "courses"));

  courses = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

async function loadClasses() {
  const snapshot = await getDocs(collection(db, "courseClasses"));

  classes = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

async function loadTotalMemberCount() {
  const result = await getCountFromServer(collection(db, "classMembers"));

  totalMemberCount = result.data().count;
}

// ======================================================
// CACHE MAHASISWA
// Seluruh mahasiswa hanya dibaca satu kali per sesi
// halaman, yaitu saat modal anggota pertama kali dibuka.
// ======================================================

async function loadStudentsOnce() {
  if (studentsLoaded) return;

  const snapshot = await getDocs(collection(db, "students"));

  students = snapshot.docs
    .map((item) => ({
      id: item.id,
      ...item.data(),
    }))
    .filter((student) => student.nim && student.name);

  studentsLoaded = true;
}

// ======================================================
// CACHE ANGGOTA BERDASARKAN MATA KULIAH
// Data anggota hanya dibaca untuk mata kuliah yang
// sedang dikelola, bukan seluruh collection.
// ======================================================

async function loadMembersByCourse(courseId) {
  if (loadedCourseMembers.has(courseId)) return;

  const q = query(
    collection(db, "classMembers"),
    where("courseId", "==", courseId),
  );

  const snapshot = await getDocs(q);

  const fetched = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
    studentNim: String(item.data().studentNim ?? ""),
  }));

  members = [
    ...members.filter((item) => item.courseId !== courseId),
    ...fetched,
  ];

  loadedCourseMembers.add(courseId);

  // Hitung jumlah anggota untuk semua kelas pada mata kuliah ini.
  const counts = new Map();

  fetched.forEach((member) => {
    counts.set(member.classId, (counts.get(member.classId) || 0) + 1);
  });

  classes
    .filter((item) => item.courseId === courseId)
    .forEach((item) => {
      classMemberCounts.set(item.id, counts.get(item.id) || 0);
    });
}

// ======================================================
// CACHE ANGGOTA PER KELAS UNTUK TAMPILAN ROSTER
// Tidak membaca ulang jika kelas sudah pernah dimuat.
// ======================================================

async function loadMembersByClass(classId) {
  if (loadedClassMembers.has(classId)) return;

  const q = query(
    collection(db, "classMembers"),
    where("classId", "==", classId),
  );

  const snapshot = await getDocs(q);

  const fetched = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
    studentNim: String(item.data().studentNim ?? ""),
  }));

  members = [...members.filter((item) => item.classId !== classId), ...fetched];

  loadedClassMembers.add(classId);
  classMemberCounts.set(classId, fetched.length);
}

// ======================================================
// COURSE OPTIONS
// ======================================================

function getCourseCode(course) {
  return course.code || course.courseCode || course.id;
}

function getCourseName(course) {
  return course.name || course.courseName || "Tanpa Nama";
}

function renderCourseOptions() {
  $("courseInput").innerHTML =
    `<option value="">Pilih Mata Kuliah</option>` +
    courses
      .map(
        (course) => `
      <option value="${escapeHTML(course.id)}">
        ${escapeHTML(getCourseCode(course))} -
        ${escapeHTML(getCourseName(course))}
      </option>
    `,
      )
      .join("");
}

function renderCourseFilter() {
  const current = $("courseFilter").value;

  $("courseFilter").innerHTML =
    `<option value="">Semua Mata Kuliah</option>` +
    courses
      .map(
        (course) => `
      <option value="${escapeHTML(course.id)}">
        ${escapeHTML(getCourseCode(course))} -
        ${escapeHTML(getCourseName(course))}
      </option>
    `,
      )
      .join("");

  $("courseFilter").value = current;
}

// ======================================================
// STATISTICS
// ======================================================

function updateStatistics() {
  $("totalClasses").textContent = classes.length;

  $("activeClasses").textContent = classes.filter(
    (item) => item.status === "active",
  ).length;

  $("totalCourses").textContent = new Set(
    classes.map((item) => item.courseId),
  ).size;

  $("totalMembers").textContent = totalMemberCount;
}

function getClassMembers(classId) {
  return members.filter((item) => item.classId === classId);
}

function getMemberCount(classId) {
  return classMemberCounts.has(classId) ? classMemberCounts.get(classId) : "—";
}

// ======================================================
// ROSTER
// ======================================================

function renderRoster(classId) {
  const classMembers = getClassMembers(classId);

  if (!classMembers.length) {
    return `
      <tr>
        <td colspan="3" class="px-5 py-8 text-center text-sm text-slate-400">
          Belum ada anggota kelas. Gunakan tombol Kelola Anggota untuk menambahkan mahasiswa.
        </td>
      </tr>
    `;
  }

  return [...classMembers]
    .sort((a, b) => String(a.studentNim).localeCompare(String(b.studentNim)))
    .map(
      (member, index) => `
      <tr class="border-t border-slate-100 transition hover:bg-slate-50">
        <td class="w-16 text-center text-slate-500">${index + 1}</td>
        <td class="font-medium text-slate-700">
          ${escapeHTML(member.studentNim)}
        </td>
        <td class="font-medium text-slate-700">
          ${escapeHTML(member.studentName || "-")}
        </td>
      </tr>
    `,
    )
    .join("");
}

// ======================================================
// CLASS TABLE
// ======================================================

function renderClasses() {
  const search = $("searchInput").value.toLowerCase().trim();
  const courseFilter = $("courseFilter").value;

  const filtered = classes.filter((item) => {
    const matchesSearch = [
      item.courseCode,
      item.courseName,
      item.className,
      item.lecturerName,
    ].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(search),
    );

    const matchesCourse = !courseFilter || item.courseId === courseFilter;

    return matchesSearch && matchesCourse;
  });

  if (!filtered.length) {
    $("classTableBody").innerHTML = `
      <tr>
        <td colspan="8" class="px-5 py-12 text-center text-sm text-slate-400">
          ${
            search || courseFilter
              ? "Kelas tidak ditemukan."
              : "Belum ada kelas. Silakan tambahkan data."
          }
        </td>
      </tr>
    `;

    $("tableInfo").textContent = "Menampilkan 0 kelas";
    lucide.createIcons();
    return;
  }

  let html = "";

  filtered.forEach((item, index) => {
    const count = getMemberCount(item.id);
    const isExpanded = expandedClassId === item.id;

    const status =
      item.status === "active"
        ? `<span class="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600">Aktif</span>`
        : `<span class="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">Tidak Aktif</span>`;

    html += `
      <tr class="border-t border-slate-100 transition hover:bg-slate-50">
        <td class="px-5 py-4 text-sm text-slate-500">${index + 1}</td>

        <td class="px-5 py-4">
          <span class="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
            ${escapeHTML(item.courseCode || "-")}
          </span>
        </td>

        <td class="px-5 py-4 text-sm font-medium text-slate-700">
          ${escapeHTML(item.courseName || "-")}
        </td>

        <td class="px-5 py-4 text-sm font-medium text-slate-700">
          ${escapeHTML(item.className || "-")}
        </td>

        <td class="px-5 py-4 text-sm text-slate-600">
          ${escapeHTML(item.lecturerName || "-")}
        </td>

        <td class="px-5 py-4 text-center">
          <span class="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
            ${count} mahasiswa
          </span>
        </td>

        <td class="px-5 py-4">${status}</td>

        <td class="px-5 py-4">
          <div class="flex items-center justify-center gap-2">
            <button
              onclick="toggleClassMembers('${escapeHTML(item.id)}')"
              title="${isExpanded ? "Tutup daftar anggota" : "Lihat anggota"}"
              class="rounded-lg p-2 ${
                isExpanded
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }"
            >
              <i data-lucide="${isExpanded ? "chevron-up" : "chevron-down"}" class="h-4 w-4"></i>
            </button>

            <button
              onclick="manageMembers('${escapeHTML(item.id)}')"
              title="Kelola anggota"
              class="rounded-lg bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100"
            >
              <i data-lucide="users" class="h-4 w-4"></i>
            </button>

            <button
              onclick="editClass('${escapeHTML(item.id)}')"
              title="Edit kelas"
              class="rounded-lg bg-blue-50 p-2 text-blue-600 hover:bg-blue-100"
            >
              <i data-lucide="pencil" class="h-4 w-4"></i>
            </button>

            <button
              onclick="removeClass('${escapeHTML(item.id)}')"
              title="Hapus kelas"
              class="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100"
            >
              <i data-lucide="trash-2" class="h-4 w-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `;

    if (isExpanded) {
      html += `
        <tr class="roster-row border-t border-slate-100">
          <td colspan="8" class="px-5 py-5">
            <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div class="flex flex-col justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center">
                <div>
                  <p class="text-sm font-bold text-slate-800">
                    Daftar Anggota ${escapeHTML(item.className || "")}
                  </p>
                  <p class="mt-1 text-xs text-slate-400">
                    ${escapeHTML(item.courseCode || "")} -
                    ${escapeHTML(item.courseName || "")}
                  </p>
                </div>

                <div class="flex items-center gap-2">
                  <span class="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                    ${count} mahasiswa
                  </span>

                  <button
                    onclick="manageMembers('${escapeHTML(item.id)}')"
                    class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <i data-lucide="user-plus" class="h-3.5 w-3.5"></i>
                    Kelola Anggota
                  </button>
                </div>
              </div>

              <div class="overflow-x-auto">
                <table class="roster-table w-full min-w-[400px] text-left text-sm">
                  <thead class="bg-white text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th class="w-16 text-center">No.</th>
                      <th class="w-1/3">NIM</th>
                      <th>Nama Mahasiswa</th>
                    </tr>
                  </thead>
                  <tbody>${renderRoster(item.id)}</tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      `;
    }
  });

  $("classTableBody").innerHTML = html;

  $("tableInfo").textContent =
    `Menampilkan ${filtered.length} dari ${classes.length} kelas`;

  lucide.createIcons();
}

window.toggleClassMembers = async function (classId) {
  const previous = expandedClassId;

  expandedClassId = previous === classId ? null : classId;
  renderClasses();

  if (expandedClassId) {
    try {
      await loadMembersByClass(classId);
      renderClasses();
    } catch (error) {
      console.error(error);
      showToast("Gagal memuat daftar anggota.", "error");
    }
  }
};

// ======================================================
// CLASS MODAL
// ======================================================

function openClassModal() {
  classModal.classList.remove("hidden");
  classModal.classList.add("flex");
}

function closeClassModal() {
  classModal.classList.add("hidden");
  classModal.classList.remove("flex");
  $("classForm").reset();
  editingClassId = null;
  $("classModalTitle").textContent = "Tambah Kelas";
  $("saveClassBtn").textContent = "Simpan Kelas";
}

$("addClassBtn").addEventListener("click", () => {
  editingClassId = null;
  $("classForm").reset();
  $("classModalTitle").textContent = "Tambah Kelas";
  $("saveClassBtn").textContent = "Simpan Kelas";
  openClassModal();
});

$("closeClassModal").addEventListener("click", closeClassModal);
$("cancelClassBtn").addEventListener("click", closeClassModal);

// ======================================================
// SAVE CLASS
// Tidak melakukan loadClasses() setelah penyimpanan.
// Cache diperbarui langsung.
// ======================================================

$("classForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSaving) return;

  const courseId = $("courseInput").value;
  const className = $("classNameInput").value.trim();
  const lecturerName = $("lecturerInput").value.trim();
  const status = $("statusInput").value;

  const selectedCourse = courses.find((item) => item.id === courseId);

  if (!selectedCourse) {
    showToast("Silakan pilih mata kuliah.", "error");
    return;
  }

  if (!className || !lecturerName) {
    showToast("Lengkapi semua data kelas.", "error");
    return;
  }

  const courseCode = getCourseCode(selectedCourse);
  const courseName = getCourseName(selectedCourse);

  const duplicate = classes.find(
    (item) =>
      item.id !== editingClassId &&
      item.courseId === courseId &&
      String(item.className || "").toLowerCase() === className.toLowerCase(),
  );

  if (duplicate) {
    showToast(
      "Nama kelas tersebut sudah digunakan pada mata kuliah ini.",
      "error",
    );
    return;
  }

  isSaving = true;
  $("saveClassBtn").disabled = true;
  $("saveClassBtn").textContent = "Menyimpan...";

  try {
    const classData = {
      courseId,
      courseCode,
      courseName,
      className,
      lecturerName,
      status,
      updatedAt: serverTimestamp(),
    };

    if (editingClassId) {
      const id = editingClassId;

      await updateDoc(doc(db, "courseClasses", id), classData);

      const index = classes.findIndex((item) => item.id === id);

      if (index !== -1) {
        classes[index] = {
          ...classes[index],
          ...classData,
        };
      }

      // Perbarui cache anggota yang sudah dimuat.
      members = members.map((member) =>
        member.classId === id
          ? {
              ...member,
              courseCode,
              courseName,
              className,
            }
          : member,
      );

      showToast("Data kelas berhasil diperbarui.");
    } else {
      const newRef = doc(collection(db, "courseClasses"));

      const newData = {
        ...classData,
        createdAt: serverTimestamp(),
      };

      await setDoc(newRef, newData);

      classes.push({
        id: newRef.id,
        ...newData,
      });

      classMemberCounts.set(newRef.id, 0);

      showToast("Kelas berhasil ditambahkan.");
    }

    closeClassModal();
    renderClasses();
    updateStatistics();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal menyimpan data kelas.", "error");
  } finally {
    isSaving = false;
    $("saveClassBtn").disabled = false;
    $("saveClassBtn").textContent = "Simpan Kelas";
  }
});

// ======================================================
// EDIT CLASS
// ======================================================

window.editClass = function (classId) {
  const item = classes.find((data) => data.id === classId);
  if (!item) return;

  editingClassId = classId;

  $("courseInput").value = item.courseId || "";
  $("classNameInput").value = item.className || "";
  $("lecturerInput").value = item.lecturerName || "";
  $("statusInput").value = item.status || "active";

  $("classModalTitle").textContent = "Edit Kelas";
  $("saveClassBtn").textContent = "Simpan Perubahan";

  openClassModal();
};

// ======================================================
// DELETE CLASS
// Tidak membaca ulang collection setelah penghapusan.
// ======================================================

window.removeClass = async function (classId) {
  const item = classes.find((data) => data.id === classId);
  if (!item) return;

  let relatedMembers;

  try {
    if (loadedCourseMembers.has(item.courseId)) {
      relatedMembers = getClassMembers(classId);
    } else {
      const q = query(
        collection(db, "classMembers"),
        where("classId", "==", classId),
      );

      const snapshot = await getDocs(q);

      relatedMembers = snapshot.docs.map((member) => ({
        id: member.id,
        ...member.data(),
        studentNim: String(member.data().studentNim ?? ""),
      }));
    }

    const confirmation = confirm(
      `Hapus kelas ${item.className}?\n\nSebanyak ${relatedMembers.length} data keanggotaan mahasiswa pada kelas ini juga akan dihapus.`,
    );

    if (!confirmation) return;

    for (let i = 0; i < relatedMembers.length; i += 450) {
      const batch = writeBatch(db);
      const chunk = relatedMembers.slice(i, i + 450);

      chunk.forEach((member) => {
        batch.delete(doc(db, "classMembers", member.id));
      });

      await batch.commit();
    }

    await deleteDoc(doc(db, "courseClasses", classId));

    classes = classes.filter((item) => item.id !== classId);
    members = members.filter((item) => item.classId !== classId);

    classMemberCounts.delete(classId);
    loadedClassMembers.delete(classId);

    // Jika cache mata kuliah sudah tersedia, perbarui cache-nya.
    if (loadedCourseMembers.has(item.courseId)) {
      loadedCourseMembers.add(item.courseId);
    }

    totalMemberCount = Math.max(0, totalMemberCount - relatedMembers.length);

    if (expandedClassId === classId) {
      expandedClassId = null;
    }

    showToast("Kelas dan data anggotanya berhasil dihapus.");

    renderClasses();
    updateStatistics();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal menghapus kelas.", "error");
  }
};

// ======================================================
// MEMBER MODAL
// ======================================================

function openMemberModal() {
  memberModal.classList.remove("hidden");
  memberModal.classList.add("flex");
}

function closeMemberModal() {
  memberModal.classList.add("hidden");
  memberModal.classList.remove("flex");

  selectedClass = null;
  selectedNims.clear();
  originalNims.clear();

  $("memberSearch").value = "";
}

$("closeMemberModal").addEventListener("click", closeMemberModal);
$("cancelMemberBtn").addEventListener("click", closeMemberModal);

// ======================================================
// MANAGE MEMBERS
// Mahasiswa dan anggota mata kuliah hanya dibaca jika
// belum tersedia di cache.
// ======================================================

window.manageMembers = async function (classId) {
  selectedClass = classes.find((item) => item.id === classId);
  if (!selectedClass) return;

  try {
    $("memberList").innerHTML = `
      <div class="p-8 text-center text-sm text-slate-400">
        Memuat mahasiswa...
      </div>
    `;

    openMemberModal();

    await Promise.all([
      loadStudentsOnce(),
      loadMembersByCourse(selectedClass.courseId),
    ]);

    const currentMembers = getClassMembers(classId);

    originalNims = new Set(
      currentMembers.map((item) => String(item.studentNim)),
    );

    selectedNims = new Set(originalNims);

    $("memberClassInfo").textContent =
      `${selectedClass.courseCode} - ${selectedClass.courseName} | ${selectedClass.className}`;

    $("memberSearch").value = "";

    renderMemberList();
  } catch (error) {
    console.error(error);
    showToast("Gagal memuat anggota kelas.", "error");
  }
};

// ======================================================
// MEMBER CONFLICT
// ======================================================

function getStudentConflict(studentNim) {
  if (!selectedClass) return null;

  const nim = String(studentNim);

  return members.find((member) => {
    if (String(member.studentNim) !== nim) return false;
    if (member.classId === selectedClass.id) return false;

    return member.courseId === selectedClass.courseId;
  });
}

// ======================================================
// RENDER MEMBER LIST
// ======================================================

function renderMemberList() {
  if (!selectedClass) return;

  const search = $("memberSearch").value.toLowerCase().trim();

  const filteredStudents = students.filter((student) => {
    const name = String(student.name || "").toLowerCase();
    const nim = String(student.nim || "").toLowerCase();

    return name.includes(search) || nim.includes(search);
  });

  const available = students.filter(
    (student) => !getStudentConflict(String(student.nim)),
  );

  $("memberCount").textContent = selectedNims.size;
  $("availableCount").textContent = available.length;
  $("selectedCount").textContent = `${selectedNims.size} dipilih`;

  if (!filteredStudents.length) {
    $("memberList").innerHTML = `
      <div class="p-8 text-center text-sm text-slate-400">
        Mahasiswa tidak ditemukan.
      </div>
    `;
    return;
  }

  $("memberList").innerHTML = filteredStudents
    .map((student) => {
      const nim = String(student.nim);
      const checked = selectedNims.has(nim);
      const conflict = getStudentConflict(nim);
      const disabled = Boolean(conflict) && !checked;

      const conflictClass = conflict
        ? classes.find((item) => item.id === conflict.classId)
        : null;

      let note;

      if (conflict) {
        note = checked
          ? "Anggota kelas ini"
          : `Sudah terdaftar di ${conflictClass?.className || "kelas lain"}`;
      } else {
        note = checked ? "Anggota kelas ini" : "Tersedia";
      }

      return `
      <label class="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 ${
        disabled
          ? "cursor-not-allowed bg-slate-50 opacity-60"
          : "hover:bg-slate-50"
      }">
        <input
          type="checkbox"
          class="member-checkbox h-4 w-4 rounded border-slate-300 text-blue-600"
          value="${escapeHTML(nim)}"
          ${checked ? "checked" : ""}
          ${disabled ? "disabled" : ""}
        >

        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600">
          ${escapeHTML((student.name || "?").charAt(0).toUpperCase())}
        </div>

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-slate-700">
            ${escapeHTML(student.name)}
          </p>
          <p class="mt-0.5 text-xs text-slate-400">
            NIM: ${escapeHTML(nim)}
          </p>
        </div>

        <span class="text-right text-xs ${
          disabled
            ? "text-red-500"
            : checked
              ? "text-blue-600"
              : "text-slate-400"
        }">
          ${escapeHTML(note)}
        </span>
      </label>
    `;
    })
    .join("");

  document.querySelectorAll(".member-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const nim = checkbox.value;

      if (checkbox.checked) {
        selectedNims.add(nim);
      } else {
        selectedNims.delete(nim);
      }

      $("memberCount").textContent = selectedNims.size;
      $("selectedCount").textContent = `${selectedNims.size} dipilih`;
    });
  });
}

$("memberSearch").addEventListener("input", renderMemberList);

// ======================================================
// SELECT ALL
// ======================================================

$("selectAllBtn").addEventListener("click", () => {
  if (!selectedClass) return;

  const search = $("memberSearch").value.toLowerCase().trim();

  const filteredStudents = students.filter((student) => {
    const name = String(student.name || "").toLowerCase();
    const nim = String(student.nim || "").toLowerCase();

    return name.includes(search) || nim.includes(search);
  });

  filteredStudents.forEach((student) => {
    const nim = String(student.nim);

    if (!getStudentConflict(nim)) {
      selectedNims.add(nim);
    }
  });

  renderMemberList();
});

// ======================================================
// SAVE MEMBERS
// Setelah batch berhasil, cache langsung diperbarui.
// Tidak ada loadMembers() atau getDocs() ulang.
// ======================================================

$("saveMembersBtn").addEventListener("click", async () => {
  if (!selectedClass || isSaving) return;

  const added = [...selectedNims].filter((nim) => !originalNims.has(nim));

  const removed = [...originalNims].filter((nim) => !selectedNims.has(nim));

  if (!added.length && !removed.length) {
    showToast("Tidak ada perubahan anggota.");
    closeMemberModal();
    return;
  }

  for (const nim of added) {
    const conflict = getStudentConflict(nim);

    if (conflict) {
      showToast(
        `NIM ${nim} sudah terdaftar pada kelas lain di mata kuliah ini.`,
        "error",
      );
      return;
    }
  }

  const updatedClass = { ...selectedClass };
  const operationCount = added.length + removed.length;

  if (operationCount > 500) {
    showToast(
      "Perubahan melebihi batas 500 operasi. Kurangi jumlah perubahan.",
      "error",
    );
    return;
  }

  isSaving = true;
  $("saveMembersBtn").disabled = true;
  $("saveMembersBtn").textContent = "Menyimpan...";

  try {
    const batch = writeBatch(db);
    const addedMembers = [];

    added.forEach((nim) => {
      const student = students.find((item) => String(item.nim) === nim);

      if (!student) return;

      const memberId = `${updatedClass.id}_${nim}`;
      const memberRef = doc(db, "classMembers", memberId);

      const memberData = {
        classId: updatedClass.id,
        courseId: updatedClass.courseId,
        courseCode: updatedClass.courseCode,
        courseName: updatedClass.courseName,
        className: updatedClass.className,
        studentNim: nim,
        studentName: student.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      batch.set(memberRef, memberData);

      addedMembers.push({
        id: memberId,
        ...memberData,
      });
    });

    removed.forEach((nim) => {
      const memberId = `${updatedClass.id}_${nim}`;

      batch.delete(doc(db, "classMembers", memberId));
    });

    await batch.commit();

    // Update cache anggota.
    members = members.filter(
      (member) =>
        !(
          member.classId === updatedClass.id &&
          removed.includes(String(member.studentNim))
        ),
    );

    members.push(...addedMembers);

    // Perbarui cache dan jumlah anggota.
    const previousCount =
      classMemberCounts.get(updatedClass.id) ?? originalNims.size;

    classMemberCounts.set(
      updatedClass.id,
      previousCount + addedMembers.length - removed.length,
    );

    totalMemberCount = Math.max(
      0,
      totalMemberCount + addedMembers.length - removed.length,
    );

    // Tandai kelas dan mata kuliah sebagai sudah memiliki cache.
    loadedCourseMembers.add(updatedClass.courseId);
    loadedClassMembers.add(updatedClass.id);

    showToast("Anggota kelas berhasil diperbarui.");

    closeMemberModal();

    expandedClassId = updatedClass.id;

    renderClasses();
    updateStatistics();
  } catch (error) {
    console.error("Simpan anggota:", error);

    showToast(error.message || "Gagal menyimpan anggota kelas.", "error");
  } finally {
    isSaving = false;
    $("saveMembersBtn").disabled = false;
    $("saveMembersBtn").innerHTML =
      `<i data-lucide="save" class="h-4 w-4"></i> Simpan Anggota`;

    lucide.createIcons();
  }
});

// ======================================================
// SEARCH & FILTER
// Seluruhnya menggunakan cache lokal.
// ======================================================

$("searchInput").addEventListener("input", renderClasses);
$("courseFilter").addEventListener("change", renderClasses);

// ======================================================
// MANUAL REFRESH
// Hanya tombol ini yang memaksa pembacaan ulang data.
// ======================================================

$("refreshBtn").addEventListener("click", async () => {
  $("refreshBtn").disabled = true;

  try {
    $("classTableBody").innerHTML = loadingRow();

    await Promise.all([loadCourses(), loadClasses(), loadTotalMemberCount()]);

    // Reset cache agar data anggota dibaca lagi hanya
    // ketika diperlukan setelah refresh manual.
    students = [];
    studentsLoaded = false;

    members = [];
    loadedCourseMembers.clear();
    loadedClassMembers.clear();
    classMemberCounts.clear();

    renderCourseOptions();
    renderCourseFilter();
    renderClasses();
    updateStatistics();

    showToast("Data berhasil diperbarui.");
  } catch (error) {
    console.error(error);
    showToast("Gagal memperbarui data.", "error");
  } finally {
    $("refreshBtn").disabled = false;
  }
});

// ======================================================
// LOGOUT
// ======================================================

$("logoutBtn").addEventListener("click", async () => {
  if (!confirm("Apakah kamu yakin ingin keluar?")) return;

  try {
    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error(error);
    showToast("Gagal keluar dari akun.", "error");
  }
});

// ======================================================
// TOAST
// ======================================================

function showToast(message, type = "success") {
  const toast = $("toast");

  $("toastMessage").textContent = message;

  toast.className =
    "fixed bottom-5 right-5 z-[80] max-w-sm rounded-xl px-5 py-4 text-sm font-medium text-white shadow-xl " +
    (type === "error" ? "bg-red-600" : "bg-emerald-600");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

// ======================================================
// HELPERS
// ======================================================

function loadingRow() {
  return `
    <tr>
      <td colspan="8" class="px-5 py-12 text-center text-sm text-slate-400">
        Memuat data kelas...
      </td>
    </tr>
  `;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };

    return entities[character];
  });
}
