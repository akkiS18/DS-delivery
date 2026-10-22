plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dsdelivery.restaurant"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dsdelivery.restaurant"
        minSdk = 26
        targetSdk = 34
        // Release builds pass -PdsVersionCode=N -PdsVersionName=x.y.z (Android needs a higher versionCode for every update).
        versionCode = (project.findProperty("dsVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("dsVersionName") as String?) ?: "1.0.0-stage1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    // Release signing (Stage 8C): the keystore and its passwords come from the environment ONLY (DS_KEYSTORE_FILE, DS_KEYSTORE_PASSWORD,
    // DS_KEY_ALIAS, DS_KEY_PASSWORD) and are never stored in the repository. Without them the release APK stays UNSIGNED (it cannot be installed),
    // never silently signed with a debug key.
    val keystorePath = System.getenv("DS_KEYSTORE_FILE")
    if (!keystorePath.isNullOrBlank()) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("DS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("DS_KEY_ALIAS")
                keyPassword = System.getenv("DS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (!keystorePath.isNullOrBlank()) signingConfig = signingConfigs.getByName("release")
            // Production must use HTTPS. Provide the real host with -PdsApiBaseUrl=https://...
            // The default is a reserved, non-resolvable placeholder so a release build can never
            // silently talk to a development server.
            val releaseBaseUrl = (project.findProperty("dsApiBaseUrl") as String?)
                ?: "https://ds-delivery.invalid/"
            require(releaseBaseUrl.startsWith("https://")) {
                "dsApiBaseUrl must be an https:// URL for release builds"
            }
            buildConfigField("String", "DEFAULT_BASE_URL", "\"$releaseBaseUrl\"")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            // Local development only: 10.0.2.2 is the Android emulator's host loopback.
            // Staging/test builds override the debug default with -PdsDebugApiBaseUrl=https://host/ ; otherwise the emulator loopback is used.
            val debugBaseUrl = (project.findProperty("dsDebugApiBaseUrl") as String?) ?: "http://10.0.2.2:4000/"
            buildConfigField("String", "DEFAULT_BASE_URL", "\"$debugBaseUrl\"")
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.11"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // AndroidX & Lifecycle
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Jetpack Compose BOM & UI
    val composeBom = platform("androidx.compose:compose-bom:2024.04.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

    // Retrofit & OkHttp
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Image loading
    implementation("io.coil-kt:coil-compose:2.6.0")

    // Debugging & Compose Preview
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
