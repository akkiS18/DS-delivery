# DS Delivery — Native Restaurant Android APK (Stage 1 & Stage 2)

DS Delivery restorani uchun native Android ilovasi (**Kotlin + Jetpack Compose Material 3**).
Ushbu bosqichda (Stage 2) mahsulotlar va toifalarni boshqarish, tahrirlash formalari, rasmlar tanlash va preview ko‘rish, mavjudlikni (availability) yoqish/o‘chirish interfeysi hamda backend uchun to‘liq CRUD shartnomalari (Repository Contracts) ishlab chiqildi.

---

## 1. Brend Ranglari (Design System Colors)

Ilova DS Delivery rasmiy brend palitrasi asosida yangilandi:
- **Primary:** `#087F5B` (Zumrad / Qora to‘q yashil)
- **Mint:** `#B8E8CF` (Yalpiz yashil)
- **Background:** `#F5FBF7` (Yumshoq oqish fon)
- **Dark:** `#1B3031` (To‘q grafit matn va sarlavhalar)

---

## 2. Loyiha Tuzilishi (Project Structure)

```text
apps/restaurant-android/
├── build.gradle.kts                # Root Gradle skripti (AGP 8.3.2, Kotlin 1.9.23)
├── settings.gradle.kts             # Modullar va omborlar (Maven Central, Google)
├── gradle.properties               # JVM va AndroidX sozlamalari
├── README.md                       # Ushbu texnik qo‘llanma
├── gradle/
│   └── wrapper/
│       └── gradle-wrapper.properties # Gradle 8.4 wrapper sozlamalari
└── app/
    ├── build.gradle.kts            # App moduli bog‘liqliklari (Compose, Retrofit, OkHttp, Coil)
    ├── proguard-rules.pro          # R8 / ProGuard qoidalari (DTO va Retrofit uchun)
    └── src/
        └── main/
            ├── AndroidManifest.xml # Ruxsatlar, Application va MainActivity
            ├── res/
            │   ├── values/         # colors.xml, strings.xml, themes.xml
            │   └── xml/            # network_security_config.xml (Lokal HTTP ruxsati)
            └── java/com/dsdelivery/restaurant/
                ├── RestaurantApp.kt # Application klassi (DI / Service Locator)
                ├── MainActivity.kt  # Compose NavHost va Activity
                ├── data/
                │   ├── api/
                │   │   ├── ApiClient.kt            # Reusable OkHttp + Retrofit mijozi
                │   │   ├── ApiConfig.kt            # Dinamik Base URL boshqaruvi
                │   │   ├── RestaurantApiService.kt # Retrofit API interfeysi
                │   │   └── dto/                    # API DTO modellari (JSON)
                │   │       ├── RestaurantDto.kt
                │   │       ├── CategoryDto.kt
                │   │       ├── ProductDto.kt
                │   │       ├── MenuResponseDto.kt
                │   │       └── ProductCrudDtos.kt  # Stage 2 CRUD so‘rov modellari
                │   ├── model/                      # Domain modellari va Resource wrapper
                │   └── repository/                 # Repository interfeysi va implementatsiyasi
                │       ├── RestaurantRepository.kt     # CRUD shartnomalari
                │       └── RestaurantRepositoryImpl.kt # Xatoliklar va Draft overlay
                └── ui/
                    ├── navigation/                 # Screen marshrutlari (Login, Menu, ProductManagement, ProductForm)
                    ├── theme/                      # Material 3 brend ranglari, shriftlar va mavzu
                    ├── components/                 # Qayta ishlatiluvchi UI komponentlar
                    │   ├── CommonComponents.kt        # ProductCard, CategoryChipRow, StatusBadge, AvailabilityBadge
                    │   ├── ImagePickerPreview.kt      # Rasm tanlash va jonli Coil preview
                    │   ├── CategoryManagementDialog.kt # Toifalarni boshqarish dialogi
                    │   └── ServerConfigDialog.kt      # Base URL sozlash dialogi
                    ├── preview/                    # Compose @Preview uchun sinov ma'lumotlari
                    └── screens/
                        ├── login/                  # Kirish ekrani (Login)
                        ├── menu/                   # Menyu ekrani (Menu)
                        └── products/               # Stage 2: Mahsulotlar boshqaruvi
                            ├── ProductManagementScreen.kt
                            ├── ProductManagementViewModel.kt
                            ├── ProductManagementUiState.kt
                            └── form/               # Yaratish va tahrirlash formasi
                                ├── ProductFormScreen.kt
                                ├── ProductFormViewModel.kt
                                └── ProductFormUiState.kt
```

---

## 3. Stage 2 da Amalga Oshirilgan Imkoniyatlar

1. **Mahsulotlarni boshqarish ekrani (`ProductManagementScreen`):**
   - Restoran mahsulotlari to‘liq ro‘yxati (mavjudligi, toifasi, narxi, fotosi bilan).
   - Qidiruv satri (Mahsulot nomi yoki tavsifi bo‘yicha tezkor izlash).
   - Toifalar bo‘yicha filtrlash chip qatori.
   - Har bir mahsulotda sotuvda mavjudlikni yoqish/o‘chirish (`Switch`).
   - Mahsulotni tahrirlash formasiga to‘g‘ridan-to‘g‘ri o‘tish tugmasi.
   - Yangi mahsulot yaratish uchun `FloatingActionButton` (`+ Yangi mahsulot`).
   - Toifalarni boshqarish dialogini ochish tugmasi.
   - Mahsulotni o‘chirish (tasdiqlash bilan).

2. **Yaratish va tahrirlash formasi (`ProductFormScreen`):**
   - **Nom maydoni:** Majburiy, 2 tadan 100 tagacha belgi, belgi sanagichi bilan.
   - **Narx maydoni:** Majburiy, 100 dan 100 000 000 so‘mgacha, real vaqtda formatlangan ko‘rinishi (masalan, `25 000 so‘m`).
   - **Toifa tanlash:** Mavjud toifalar ro‘yxatidan tanlash chiplari.
   - **Mavjudlik kaliti (Availability Switch):** Sotuvda faol yoki vaqtincha to‘xtatilgan holatni belgilash.
   - **Tavsif maydoni:** 1000 belgigacha bo‘lgan erkin matn.
   - **Foto tanlash va Preview:** Rasm URL kiritish, tayyor taom rasmlari presetlari, yoki qurilma galereyasidan tanlash.

3. **Toifalarni boshqarish dialogi (`CategoryManagementDialog`):**
   - Mavjud toifalar ro‘yxati, tartib raqami va unga biriktirilgan mahsulotlar soni.
   - Yangi toifa nomi va tartib raqamini kiritib qo‘shish.
   - Toifa nomini tahrirlash va o‘chirish.

4. **Xavfsiz va shaffof arxitektura (No Fake Server Mutations):**
   - Backendda hozircha autentifikatsiya va mahsulotlarni o‘zgartirish API'si mavjud emasligi sababli, ilovada **hech qanday soxta server yozuvi ko‘rsatilmaydi**.
   - Foydalanuvchi "Lokal saqlash (Preview)" orqali o‘zgartirishlarni ushbu sessiyada ko‘rishi va sinashi mumkin.
   - Agar "Serverga yuborish (Sinov)" tugmasi bosilsa, `RestaurantRepository` rasmiy ravishda xatolik qaytaradi va yetishmayotgan backend API talablarini aks ettiruvchi dialog ochiladi.

---

## 4. Talab Qilinadigan Backend API Shartnomalari (Missing API Specifications)

Stage 2+ uchun Fastify backendida quyidagi REST endpointlarni amalga oshirish talab qilinadi:

### A. Mahsulotlar (Products) CRUD

#### 1. Yangi mahsulot yaratish
- **Method & Path:** `POST /api/v1/restaurant/products`
- **Headers:**
  ```http
  Authorization: Bearer <RESTAURANT_SESSION_TOKEN>
  Content-Type: application/json
  ```
- **Request Body:**
  ```json
  {
    "name": "Klassik Burger",
    "priceSom": 25000,
    "description": "Suvli mol go‘shti va sous",
    "categoryId": "cuid_category_id",
    "imageUrl": "https://example.com/burger.jpg",
    "isAvailable": true
  }
  ```
- **Validation Rules:**
  - `name`: string, min 2, max 100.
  - `priceSom`: integer, min 100, max 100 000 000.
  - `description`: string, max 1000, optional.
  - `categoryId`: string, optional (agar kiritilsa, joriy restoranga tegishli bo‘lishi shart).
  - `isAvailable`: boolean, default `true`.
- **Response (201 Created):**
  ```json
  {
    "id": "cuid_product_id",
    "restaurantId": "cuid_restaurant_id",
    "categoryId": "cuid_category_id",
    "name": "Klassik Burger",
    "description": "Suvli mol go‘shti va sous",
    "priceSom": 25000,
    "imageUrl": "https://example.com/burger.jpg",
    "isAvailable": true,
    "createdAt": "2026-10-17T06:00:00.000Z",
    "updatedAt": "2026-10-17T06:00:00.000Z"
  }
  ```

#### 2. Mahsulotni tahrirlash
- **Method & Path:** `PUT /api/v1/restaurant/products/:id`
- **Headers:** `Authorization: Bearer <TOKEN>`
- **Request Body:** Barcha maydonlar ixtiyoriy (partial update).
- **Response (200 OK):** Yangilangan Product obyekti.
- **Error (404 Not Found):** Agar mahsulot topilmasa yoki boshqa restoranga tegishli bo‘lsa.

#### 3. Mahsulot mavjudligini o‘zgartirish (Tezkor switch)
- **Method & Path:** `PATCH /api/v1/restaurant/products/:id/availability`
- **Headers:** `Authorization: Bearer <TOKEN>`
- **Request Body:**
  ```json
  {
    "isAvailable": false
  }
  ```
- **Response (200 OK):** `{ "id": "...", "isAvailable": false }`.

#### 4. Mahsulotni o‘chirish
- **Method & Path:** `DELETE /api/v1/restaurant/products/:id`
- **Headers:** `Authorization: Bearer <TOKEN>`
- **Response (200 OK):** `{ "success": true, "deletedId": "..." }`.

---

### B. Toifalar (Categories) CRUD

#### 1. Yangi toifa yaratish
- **Method & Path:** `POST /api/v1/restaurant/categories`
- **Headers:** `Authorization: Bearer <TOKEN>`
- **Request Body:**
  ```json
  {
    "name": "Desertlar",
    "position": 4
  }
  ```
- **Response (201 Created):** `{ "id": "...", "name": "Desertlar", "position": 4 }`.

#### 2. Toifani tahrirlash
- **Method & Path:** `PUT /api/v1/restaurant/categories/:id`
- **Headers:** `Authorization: Bearer <TOKEN>`
- **Request Body:** `{ "name": "Yangi nom", "position": 2 }`
- **Response (200 OK):** Yangilangan toifa obyekti.

#### 3. Toifani o‘chirish
- **Method & Path:** `DELETE /api/v1/restaurant/categories/:id`
- **Headers:** `Authorization: Bearer <TOKEN>`
- **Response (200 OK):** `{ "success": true }`.

---

### C. Rasm yuklash (Image Upload)
- **Method & Path:** `POST /api/v1/restaurant/upload`
- **Headers:** `Authorization: Bearer <TOKEN>`, `Content-Type: multipart/form-data`
- **Form Data:** `file: <binary image (JPEG/PNG/WebP, max 5MB)>`
- **Response (201 Created):**
  ```json
  {
    "url": "https://storage.dsdelivery.uz/products/burger_123.jpg"
  }
  ```

---

## 5. Qo‘lda Sinash Yo‘riqnomasi (Manual Testing Guide)

1. **Android Studio'da loyihani ochish:**
   - `DS-gemini/apps/restaurant-android` papkasini oching.
   - Gradle sinxronizatsiyasini kuting.

2. **Ilovani ishga tushirish:**
   - Android Emulator yoki USB orqali ulangan haqiqiy telefonda **Run 'app'** tugmasini bosing.

3. **Sinov Bosqichlari:**
   - **Kirish ekrani:** "Ko‘rish rejimida kirish (Demo)" tugmasini bosib menyuga kiring.
   - **Menyu ekrani:**
     - Yuqoridagi "Boshqaruv" tugmasini bosing yoki o‘ng pastdagi "Boshqaruv" FAB'ini bosing.
   - **Mahsulotlar boshqaruvi ekrani:**
     - Qidiruv maydoniga matn kiritib mahsulotlarni filtrlab ko‘ring.
     - Mahsulot kartasidagi "Sotuvda faol" kalitini bosing (darhol "To‘xtatilgan" holatiga o‘tadi va visual shaffoflik o‘zgaradi).
     - Yuqori paneldagi "Toifalar" tugmasini bosing: yangi toifa qo‘shing yoki mavjudlarini tahrirlang.
     - "Yangi mahsulot" FAB tugmasini bosing.
   - **Yangi mahsulot formasi:**
     - Noto‘g‘ri qiymatlar kiritib tekshiring (bo‘sh nom, 50 so‘m narx) -> xatolik ko‘rsatiladi.
     - To‘g‘ri ma'lumotlar kiriting: Nomi: "Mega Lavash", Narxi: "32000".
     - Toifani tanlang.
     - Rasm bo‘limida tezkor "Burger" yoki "Pizza" presetini tanlang -> jonli rasm yuklanadi.
     - "Serverga sinash" tugmasini bosing: backend CRUD API talablari haqida batafsil ma'lumot beruvchi dialog ochiladi.
     - "Qo‘shish (Preview)" tugmasini bosing: mahsulot ro‘yxatga qo‘shiladi va siz darhol uni boshqaruv ekranida ko‘rasiz.
