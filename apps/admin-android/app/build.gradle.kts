plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dsdelivery.admin"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dsdelivery.admin"
        minSdk = 26
        targetSdk = 34
        // Release builds pass -PdsVersionCode=N -PdsVersionName=x.y.z (Android needs a higher versionCode for every update).
        versionCode = (project.findProperty("dsVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("dsVersionName") as String?) ?: "1.0.0-dev"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    // Release signing: the keystore and its passwords come from the environment ONLY (DS_KEYSTORE_FILE, DS_KEYSTORE_PASSWORD,
    // DS_KEY_ALIAS, DS_KEY_PASSWORD) and are never stored in the repository. Without them the release APK stays UNSIGNED (it cannot be
    // installed), never silently signed with a debug key.
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
            // Production must use HTTPS. The default is a reserved, non-resolvable placeholder so a release build can never
            // silently talk to a development server. Pass the real host with -PdsApiBaseUrl=https://...
            val releaseBaseUrl = (project.findProperty("dsApiBaseUrl") as String?) ?: "https://ds-delivery.invalid/"
            require(releaseBaseUrl.startsWith("https://")) { "dsApiBaseUrl must be an https:// URL for release builds" }
            buildConfigField("String", "API_BASE_URL", "\"$releaseBaseUrl\"")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            // Staging/test builds pass -PdsDebugApiBaseUrl=https://host/ ; otherwise the emulator loopback is used.
            val debugBaseUrl = (project.findProperty("dsDebugApiBaseUrl") as String?) ?: "http://10.0.2.2:4000/"
            buildConfigField("String", "API_BASE_URL", "\"$debugBaseUrl\"")
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

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    val composeBom = platform("androidx.compose:compose-bom:2024.04.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
