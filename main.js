// ========================================
// إدارة الوضع النهاري والليلي
// ========================================

const themeButton = document.getElementById("theme-toggle");

// استعادة الوضع المحفوظ
const savedTheme = localStorage.getItem("site-theme");

// تحديد الوضع عند فتح الصفحة
if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
} else {
    document.body.classList.remove("dark-mode");
}

// تحديث وصف الزر دون تغيير الأيقونات
function updateThemeButton() {

    if (!themeButton) return;

    const darkMode = document.body.classList.contains("dark-mode");

    if (darkMode) {

        themeButton.setAttribute(
            "aria-label",
            "تفعيل الوضع النهاري"
        );

        themeButton.setAttribute(
            "title",
            "تفعيل الوضع النهاري"
        );

    } else {

        themeButton.setAttribute(
            "aria-label",
            "تفعيل الوضع الليلي"
        );

        themeButton.setAttribute(
            "title",
            "تفعيل الوضع الليلي"
        );

    }
}

// تحديث الزر عند فتح الصفحة
updateThemeButton();

// التبديل بين الوضعين
if (themeButton) {

    themeButton.addEventListener("click", function () {

        document.body.classList.toggle("dark-mode");

        const darkMode = document.body.classList.contains("dark-mode");

        localStorage.setItem(
            "site-theme",
            darkMode ? "dark" : "light"
        );

        updateThemeButton();

    });

}