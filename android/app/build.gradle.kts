plugins {
    id("com.android.application")
}

android {
    namespace = "uz.talabamakon.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "uz.talabamakon.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // Doimiy imzo kaliti (ixtiyoriy): GitHub Secrets orqali beriladi — shunda yangi versiya eskisining ustiga oʻrnatiladi
    val keystore = System.getenv("TM_KEYSTORE")
    signingConfigs {
        create("release") {
            if (keystore != null) {
                storeFile = file(keystore)
                storePassword = System.getenv("TM_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("TM_KEY_ALIAS")
                keyPassword = System.getenv("TM_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystore != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
