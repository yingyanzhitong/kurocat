plugins {
    id("com.android.application")
}

import java.io.File
import java.util.Properties

android {
    namespace = "com.kurocat.pet"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kurocat.pet"
        minSdk = 26
        targetSdk = 35
        versionCode = 50004
        versionName = "5.0.4"
    }

    val signingPropsFile = File("${System.getProperty("user.home")}/.kurocat-android/signing.properties")
    val signingProps = Properties().apply {
        if (signingPropsFile.exists()) {
            signingPropsFile.inputStream().use { load(it) }
        }
    }
    val keystorePath = System.getenv("KUROCAT_ANDROID_KEYSTORE")
        ?: signingProps.getProperty("storeFile")
        ?: "${System.getProperty("user.home")}/.kurocat-android/kurocat-release.jks"
    val keystoreFile = File(keystorePath)
    val storePass = System.getenv("KUROCAT_ANDROID_STORE_PASS") ?: signingProps.getProperty("storePassword")
    val keyAliasVal = System.getenv("KUROCAT_ANDROID_KEY_ALIAS") ?: signingProps.getProperty("keyAlias")
    val keyPass = System.getenv("KUROCAT_ANDROID_KEY_PASS") ?: signingProps.getProperty("keyPassword")

    signingConfigs {
        if (keystoreFile.exists() && !storePass.isNullOrBlank() && !keyAliasVal.isNullOrBlank() && !keyPass.isNullOrBlank()) {
            create("release") {
                storeFile = keystoreFile
                storePassword = storePass
                keyAlias = keyAliasVal
                keyPassword = keyPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfigs.findByName("release")?.let {
                signingConfig = it
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.14.0")
}
