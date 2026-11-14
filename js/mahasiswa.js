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
  deleteDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// =====================================
// ELEMENT
// =====================================

const studentTable = document.getElementById("studentTable");
const totalStudents = document.getElementById("totalStudents");
const tableInfo = document.getElementById("tableInfo");

const studentModal = document.getElementById("studentModal");
const studentForm = document.getElementById("studentForm");

const nimInput = document.getElementById("nimInput");
const nameInput = document.getElementById("nameInput");

const modalTitle = document.getElementById("modalTitle");
const saveButton = document.getElementById("saveButton");
const formError = document.getElementById("formError");

const searchInput = document.getElementById("searchInput");
const sortField = document.getElementById("sortField");
const sortDirection = document.getElementById("sortDirection");
const cohortFilter = document.getElementById("cohortFilter");

const dragInfo = document.getElementById("dragInfo");
const toast = document.getElementById("toast");

const excelInput = document.getElementById("excelInput");
const uploadExcelButton = document.getElementById("uploadExcelButton");

const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");

let students = [];
let editingNim = null;
let toastTimer;
let draggedStudentId = null;
let isSavingOrder = false;
let isLoading = false;

// =====================================
// HELPER
// =====================================

function escapeHTML(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}

function createIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

function showToast(message, type = "success") {
  clearTimeout(toastTimer);

  toast.textContent = message;

  toast.className =
    "fixed bottom-5 right-5 z-[80] max-w-sm rounded-xl px-5 py-4 text-sm font-medium text-white shadow-xl " +
    (type === "success" ? "bg-emerald-600" : "bg-red-600");

  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

function formatDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "-";
  }

  const date = timestamp.toDate();

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

// =====================================
// MOBILE SIDEBAR
// =====================================

document.getElementById("openSidebar").addEventListener("click", () => {
  sidebar.classList.add("show");
  overlay.classList.remove("hidden");
});

function closeSidebar() {
  sidebar.classList.remove("show");
  overlay.classList.add("hidden");
}

document.getElementById("closeSidebar").addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);

// =====================================
// LOAD STUDENTS
// =====================================

// getDocs hanya dijalankan saat halaman pertama kali dimuat.
// Tidak dipanggil lagi setelah tambah, edit, hapus, atau import.

async function loadStudents() {
  if (isLoading) return;

  isLoading = true;

  studentTable.innerHTML = `
    <tr>
      <td colspan="5" class="px-5 py-12 text-center text-sm text-slate-400">
        Memuat data mahasiswa...
      </td>
    </tr>
  `;

  try {
    const snapshot = await getDocs(collection(db, "students"));

    students = snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

    sortStudentsManual();

    updateCohortOptions();
    renderStudents();

    console.info(`Berhasil memuat ${students.length} mahasiswa.`);
  } catch (error) {
    console.error("Load students error:", error);

    studentTable.innerHTML = `
      <tr>
        <td colspan="5" class="px-5 py-12 text-center text-sm text-red-500">
          Gagal mengambil data. Periksa Firestore Rules dan koneksi Firebase.
        </td>
      </tr>
    `;

    showToast("Gagal memuat data mahasiswa.", "error");
  } finally {
    isLoading = false;
  }
}

function sortStudentsManual() {
  students.sort((a, b) => {
    const orderA = Number.isFinite(Number(a.sortOrder))
      ? Number(a.sortOrder)
      : Number.MAX_SAFE_INTEGER;

    const orderB = Number.isFinite(Number(b.sortOrder))
      ? Number(b.sortOrder)
      : Number.MAX_SAFE_INTEGER;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return (a.name || "").localeCompare(b.name || "", "id");
  });
}

// =====================================
// IMPORT EXCEL
// =====================================

uploadExcelButton.addEventListener("click", () => {
  excelInput.click();
});

excelInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (!file) return;

  event.target.value = "";

  const extension = file.name.split(".").pop().toLowerCase();

  if (!["xlsx", "xls"].includes(extension)) {
    showToast("Format file harus .xlsx atau .xls.", "error");
    return;
  }

  uploadExcelButton.disabled = true;

  uploadExcelButton.innerHTML = `
    <i data-lucide="loader-circle" class="h-5 w-5 animate-spin"></i>
    Memproses Excel...
  `;

  createIcons();

  try {
    if (typeof XLSX === "undefined") {
      throw new Error("Library Excel belum berhasil dimuat.");
    }

    const buffer = await file.arrayBuffer();

    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
    });

    if (!workbook.SheetNames.length) {
      throw new Error("File Excel tidak memiliki sheet.");
    }

    const sheetName =
      workbook.SheetNames.find(
        (name) => name.trim().toLowerCase() === "absensi",
      ) || workbook.SheetNames[0];

    const worksheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      defval: "",
      raw: false,
    });

    if (!rows.length) {
      throw new Error("Sheet Excel tidak memiliki data.");
    }

    const normalizeHeader = (value) =>
      String(value).trim().toLowerCase().replace(/\s+/g, " ");

    const headers = Object.keys(rows[0]);

    const nimHeader = headers.find(
      (header) => normalizeHeader(header) === "nim",
    );

    const nameHeader = headers.find((header) =>
      ["nama mahasiswa", "nama lengkap", "nama"].includes(
        normalizeHeader(header),
      ),
    );

    if (!nimHeader || !nameHeader) {
      throw new Error("Kolom NIM dan NAMA MAHASISWA tidak ditemukan.");
    }

    const importedStudents = [];
    const seenNim = new Set();

    let invalidCount = 0;
    let duplicateInFileCount = 0;

    rows.forEach((row) => {
      const nim = String(row[nimHeader] ?? "")
        .trim()
        .replace(/\.0$/, "");

      const name = String(row[nameHeader] ?? "")
        .trim()
        .replace(/\s+/g, " ");

      if (!nim && !name) return;

      if (!nim || !/^[a-zA-Z0-9_-]+$/.test(nim) || name.length < 3) {
        invalidCount++;
        return;
      }

      if (seenNim.has(nim)) {
        duplicateInFileCount++;
        return;
      }

      seenNim.add(nim);
      importedStudents.push({ nim, name });
    });

    if (!importedStudents.length) {
      throw new Error("Tidak ada data mahasiswa valid untuk diimpor.");
    }

    // OPTIMASI:
    // Periksa duplikat dari array yang sudah ada di memori.
    // Tidak perlu getDocs(collection(db, "students")) lagi.

    const existingNim = new Set(students.map((student) => student.id));

    const newStudents = importedStudents.filter(
      (student) => !existingNim.has(student.nim),
    );

    const duplicateInDatabaseCount =
      importedStudents.length - newStudents.length;

    if (!newStudents.length) {
      alert(
        "Tidak ada data baru untuk ditambahkan.\n\n" +
          `NIM sudah terdaftar: ${duplicateInDatabaseCount}\n` +
          `NIM duplikat di Excel: ${duplicateInFileCount}\n` +
          `Baris tidak valid: ${invalidCount}`,
      );

      return;
    }

    let successCount = 0;

    for (let index = 0; index < newStudents.length; index += 400) {
      const batch = writeBatch(db);
      const chunk = newStudents.slice(index, index + 400);

      chunk.forEach((student, chunkIndex) => {
        const studentRef = doc(db, "students", student.nim);

        const sortOrder = students.length + index + chunkIndex;

        batch.set(studentRef, {
          nim: student.nim,
          name: student.name,
          sortOrder,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();

      successCount += chunk.length;
    }

    // Perbarui array lokal tanpa membaca ulang Firestore.
    const now = Timestamp.now();

    newStudents.forEach((student, index) => {
      students.push({
        id: student.nim,
        nim: student.nim,
        name: student.name,
        sortOrder: students.length,
        createdAt: now,
      });
    });

    sortStudentsManual();
    updateCohortOptions();
    renderStudents();

    alert(
      "IMPORT EXCEL BERHASIL\n\n" +
        `Berhasil ditambahkan: ${successCount}\n` +
        `NIM sudah terdaftar: ${duplicateInDatabaseCount}\n` +
        `NIM duplikat di Excel: ${duplicateInFileCount}\n` +
        `Baris tidak valid: ${invalidCount}`,
    );
  } catch (error) {
    console.error("Import Excel Error:", error);

    if (error.code === "permission-denied") {
      showToast("Akses ditolak. Periksa Firestore Rules.", "error");
    } else {
      showToast(error.message || "Gagal mengimpor Excel.", "error");
    }
  } finally {
    uploadExcelButton.disabled = false;

    uploadExcelButton.innerHTML = `
      <i data-lucide="file-up" class="h-5 w-5"></i>
      Upload Excel
    `;

    createIcons();
  }
});

// =====================================
// ANGKATAN
// =====================================

function getStudentCohort(student) {
  const nim = String(student.nim || student.id || "").trim();
  const match = nim.match(/^(\d{2})/);

  return match ? match[1] : "";
}

function updateCohortOptions() {
  const selected = cohortFilter.value || "all";

  const cohorts = [
    ...new Set(students.map(getStudentCohort).filter(Boolean)),
  ].sort((a, b) => Number(b) - Number(a));

  cohortFilter.innerHTML = `
    <option value="all">Semua Angkatan</option>
    ${cohorts
      .map(
        (year) =>
          `<option value="${escapeHTML(year)}">Angkatan 20${escapeHTML(year)}</option>`,
      )
      .join("")}
  `;

  cohortFilter.value = cohorts.includes(selected) ? selected : "all";
}

// =====================================
// RENDER TABLE
// =====================================

function isManualView() {
  return (
    sortField.value === "manual" &&
    !searchInput.value.trim() &&
    cohortFilter.value === "all"
  );
}

function updateDragInfo() {
  if (isManualView()) {
    dragInfo.innerHTML = `
      <i data-lucide="grip-vertical" class="h-4 w-4 text-blue-500"></i>
      Pilih "Urutan manual", lalu tarik ikon pada baris untuk mengubah
      urutan mahasiswa. Angkatan diambil dari empat digit pertama NIM.
    `;
  } else {
    dragInfo.innerHTML = `
      <i data-lucide="info" class="h-4 w-4 text-blue-500"></i>
      Drag & drop aktif pada tampilan urutan manual tanpa pencarian dan filter.
      Angkatan diambil dari empat digit pertama NIM.
    `;
  }

  createIcons();
}

function renderStudents() {
  const keyword = searchInput.value.trim().toLowerCase();
  const selectedCohort = cohortFilter.value;

  let filtered = students.filter((student) => {
    const nim = String(student.nim || student.id).toLowerCase();
    const name = String(student.name || "").toLowerCase();

    const matchesKeyword = nim.includes(keyword) || name.includes(keyword);

    const matchesCohort =
      selectedCohort === "all" || getStudentCohort(student) === selectedCohort;

    return matchesKeyword && matchesCohort;
  });

  if (sortField.value !== "manual") {
    const field = sortField.value;
    const direction = sortDirection.value === "desc" ? -1 : 1;

    filtered = [...filtered].sort((a, b) => {
      const valueA = String(field === "nim" ? a.nim || a.id : a.name || "");

      const valueB = String(field === "nim" ? b.nim || b.id : b.name || "");

      const result = valueA.localeCompare(valueB, "id", {
        numeric: field === "nim",
        sensitivity: "base",
      });

      return result * direction;
    });
  }

  totalStudents.textContent = students.length;

  tableInfo.textContent = `Menampilkan ${filtered.length} dari ${students.length} mahasiswa`;

  updateDragInfo();

  if (filtered.length === 0) {
    studentTable.innerHTML = `
      <tr>
        <td colspan="5" class="px-5 py-12 text-center">
          <div class="flex flex-col items-center">
            <div class="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <i data-lucide="users" class="h-7 w-7"></i>
            </div>
            <p class="font-medium text-slate-600">
              ${
                keyword || selectedCohort !== "all"
                  ? "Mahasiswa tidak ditemukan"
                  : "Belum ada data mahasiswa"
              }
            </p>
            <p class="mt-1 text-xs text-slate-400">
              ${
                keyword || selectedCohort !== "all"
                  ? "Coba ubah kata kunci atau filter angkatan."
                  : "Klik Tambah Mahasiswa untuk memasukkan data."
              }
            </p>
          </div>
        </td>
      </tr>
    `;

    createIcons();
    return;
  }

  const canDrag = isManualView() && !isSavingOrder;

  studentTable.innerHTML = filtered
    .map(
      (student, index) => `
        <tr
          data-student-row="${escapeHTML(student.id)}"
          class="border-t border-slate-100 transition hover:bg-slate-50"
        >
          <td class="px-5 py-4 text-sm text-slate-500">
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="drag-handle rounded-lg p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600 ${
                  canDrag
                    ? "cursor-grab active:cursor-grabbing"
                    : "cursor-not-allowed opacity-40"
                }"
                data-drag="${escapeHTML(student.id)}"
                draggable="${canDrag ? "true" : "false"}"
                title="${
                  canDrag
                    ? "Tarik untuk mengubah urutan"
                    : "Aktifkan urutan manual tanpa filter untuk drag & drop"
                }"
                ${canDrag ? "" : "disabled"}
              >
                <i data-lucide="grip-vertical" class="h-4 w-4"></i>
              </button>
              ${index + 1}
            </div>
          </td>

          <td class="px-5 py-4">
            <span class="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
              ${escapeHTML(student.nim || student.id)}
            </span>
          </td>

          <td class="px-5 py-4 text-sm font-medium text-slate-700">
            ${escapeHTML(student.name || "-")}
          </td>

          <td class="px-5 py-4 text-sm text-slate-500">
            ${formatDate(student.createdAt)}
          </td>

          <td class="px-5 py-4">
            <div class="flex items-center justify-center gap-2">
              <button
                data-edit="${escapeHTML(student.id)}"
                class="rounded-lg bg-blue-50 p-2 text-blue-600 transition hover:bg-blue-100"
                title="Edit"
              >
                <i data-lucide="pencil" class="h-4 w-4"></i>
              </button>

              <button
                data-delete="${escapeHTML(student.id)}"
                class="rounded-lg bg-red-50 p-2 text-red-600 transition hover:bg-red-100"
                title="Hapus"
              >
                <i data-lucide="trash-2" class="h-4 w-4"></i>
              </button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");

  createIcons();
}

// =====================================
// FILTER DAN PENCARIAN
// =====================================

searchInput.addEventListener("input", renderStudents);
sortField.addEventListener("change", renderStudents);
sortDirection.addEventListener("change", renderStudents);
cohortFilter.addEventListener("change", renderStudents);

// =====================================
// DRAG & DROP
// =====================================

studentTable.addEventListener("dragstart", (event) => {
  const handle = event.target.closest("[data-drag]");

  if (!handle || !isManualView() || isSavingOrder) {
    event.preventDefault();
    return;
  }

  draggedStudentId = handle.dataset.drag;

  const row = handle.closest("tr");

  row.classList.add("opacity-40");

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedStudentId);
});

studentTable.addEventListener("dragover", (event) => {
  const targetRow = event.target.closest("[data-student-row]");

  if (!draggedStudentId || !targetRow || !isManualView()) return;

  event.preventDefault();

  event.dataTransfer.dropEffect = "move";
  targetRow.classList.add("bg-blue-50");
});

studentTable.addEventListener("dragleave", (event) => {
  const targetRow = event.target.closest("[data-student-row]");

  if (targetRow && !targetRow.contains(event.relatedTarget)) {
    targetRow.classList.remove("bg-blue-50");
  }
});

studentTable.addEventListener("drop", async (event) => {
  const targetRow = event.target.closest("[data-student-row]");

  if (!draggedStudentId || !targetRow || !isManualView()) return;

  event.preventDefault();

  const targetStudentId = targetRow.dataset.studentRow;

  const fromIndex = students.findIndex(
    (student) => student.id === draggedStudentId,
  );

  const toIndex = students.findIndex(
    (student) => student.id === targetStudentId,
  );

  if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
    const [movedStudent] = students.splice(fromIndex, 1);

    students.splice(toIndex, 0, movedStudent);

    draggedStudentId = null;

    await saveStudentOrder();
  }
});

studentTable.addEventListener("dragend", () => {
  draggedStudentId = null;

  studentTable.querySelectorAll("tr").forEach((row) => {
    row.classList.remove("opacity-40", "bg-blue-50");
  });
});

// =====================================
// SIMPAN URUTAN
// =====================================

async function saveStudentOrder() {
  if (isSavingOrder) return;

  isSavingOrder = true;
  renderStudents();

  try {
    for (let index = 0; index < students.length; index += 400) {
      const batch = writeBatch(db);
      const chunk = students.slice(index, index + 400);

      chunk.forEach((student, chunkIndex) => {
        batch.update(doc(db, "students", student.id), {
          sortOrder: index + chunkIndex,
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
    }

    students = students.map((student, index) => ({
      ...student,
      sortOrder: index,
    }));

    showToast("Urutan mahasiswa berhasil disimpan.");
  } catch (error) {
    console.error("Save student order error:", error);

    showToast("Gagal menyimpan urutan mahasiswa.", "error");

    // Tidak melakukan pembacaan ulang seluruh koleksi.
    // Urutan lokal dikembalikan berdasarkan sortOrder sebelumnya.
    students.sort((a, b) => {
      const aOrder = Number(a.sortOrder ?? Number.MAX_SAFE_INTEGER);
      const bOrder = Number(b.sortOrder ?? Number.MAX_SAFE_INTEGER);
      return aOrder - bOrder;
    });
  } finally {
    isSavingOrder = false;
    renderStudents();
  }
}

// =====================================
// MODAL
// =====================================

function openModal() {
  studentModal.classList.remove("hidden");
  studentModal.classList.add("flex");
}

function closeModal() {
  studentModal.classList.add("hidden");
  studentModal.classList.remove("flex");

  studentForm.reset();

  editingNim = null;

  modalTitle.textContent = "Tambah Mahasiswa";
  saveButton.textContent = "Simpan Mahasiswa";

  nimInput.disabled = false;

  formError.classList.add("hidden");
  formError.textContent = "";
}

document.getElementById("addButton").addEventListener("click", () => {
  closeModal();
  openModal();
  nimInput.focus();
});

document.getElementById("closeModal").addEventListener("click", closeModal);
document.getElementById("cancelButton").addEventListener("click", closeModal);

// =====================================
// EDIT STUDENT
// =====================================

function editStudent(nim) {
  const student = students.find((item) => item.id === nim);

  if (!student) return;

  editingNim = nim;

  modalTitle.textContent = "Edit Mahasiswa";
  saveButton.textContent = "Simpan Perubahan";

  nimInput.value = student.nim || student.id;
  nameInput.value = student.name || "";

  nimInput.disabled = true;

  openModal();
}

// =====================================
// SAVE STUDENT
// =====================================

studentForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const nim = nimInput.value.trim();
  const name = nameInput.value.trim();

  if (!nim || !name) {
    showFormError("NIM dan nama lengkap wajib diisi.");
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(nim)) {
    showFormError(
      "NIM hanya boleh berisi huruf, angka, garis bawah, atau tanda hubung.",
    );
    return;
  }

  if (name.length < 3) {
    showFormError("Nama lengkap minimal 3 karakter.");
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Menyimpan...";
  formError.classList.add("hidden");

  try {
    const studentRef = doc(db, "students", nim);

    if (editingNim) {
      await updateDoc(studentRef, {
        name,
        updatedAt: serverTimestamp(),
      });

      // Perbarui data lokal, tanpa getDocs.
      students = students.map((student) =>
        student.id === editingNim ? { ...student, name } : student,
      );

      showToast("Data mahasiswa berhasil diperbarui.");
    } else {
      // Periksa NIM menggunakan data lokal.
      const existingStudent = students.some((student) => student.id === nim);

      if (existingStudent) {
        showFormError("NIM tersebut sudah terdaftar.");
        return;
      }

      const now = Timestamp.now();

      await setDoc(studentRef, {
        nim,
        name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        sortOrder: students.length,
      });

      // Tambahkan ke memori lokal.
      students.push({
        id: nim,
        nim,
        name,
        createdAt: now,
        sortOrder: students.length,
      });

      showToast("Mahasiswa berhasil ditambahkan.");
    }

    sortStudentsManual();
    updateCohortOptions();
    renderStudents();

    closeModal();
  } catch (error) {
    console.error("Save student error:", error);

    if (error.code === "permission-denied") {
      showFormError("Akses ditolak. Periksa Firestore Rules.");
    } else {
      showFormError("Gagal menyimpan data. Silakan coba lagi.");
    }
  } finally {
    saveButton.disabled = false;

    saveButton.textContent = editingNim
      ? "Simpan Perubahan"
      : "Simpan Mahasiswa";
  }
});

// =====================================
// DELETE STUDENT
// =====================================

async function deleteStudent(nim) {
  const student = students.find((item) => item.id === nim);

  if (!student) return;

  const confirmation = confirm(
    `Apakah kamu yakin ingin menghapus data ${student.name || nim}?`,
  );

  if (!confirmation) return;

  try {
    await deleteDoc(doc(db, "students", nim));

    // Hapus dari array lokal, tanpa membaca ulang koleksi.
    students = students.filter((item) => item.id !== nim);

    updateCohortOptions();
    renderStudents();

    showToast("Data mahasiswa berhasil dihapus.");
  } catch (error) {
    console.error("Delete student error:", error);

    showToast("Gagal menghapus data mahasiswa.", "error");
  }
}

// =====================================
// TOMBOL EDIT DAN HAPUS
// =====================================

studentTable.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");

  if (editButton) {
    editStudent(editButton.dataset.edit);
  }

  if (deleteButton) {
    deleteStudent(deleteButton.dataset.delete);
  }
});

// =====================================
// AUTHENTICATION CHECK
// =====================================

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
      // Satu pembacaan dokumen admin.
      const adminRef = doc(db, "admins", user.uid);
      const adminSnapshot = await getDoc(adminRef);

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

      document.getElementById("adminName").textContent =
        adminData.name || "Administrator";

      // Satu kali load koleksi mahasiswa.
      await loadStudents();
    } catch (error) {
      console.error("Authentication check error:", error);

      alert("Gagal memeriksa akses administrator.");

      await signOut(auth);

      window.location.replace("../login.html");
    }
  });
}

// =====================================
// LOGOUT
// =====================================

document.getElementById("logoutButton").addEventListener("click", async () => {
  if (!confirm("Apakah kamu yakin ingin keluar?")) return;

  try {
    await signOut(auth);
    window.location.replace("../login.html");
  } catch (error) {
    console.error("Logout error:", error);

    showToast("Gagal keluar dari akun.", "error");
  }
});

// =====================================
// START APPLICATION
// =====================================

initializePage();
