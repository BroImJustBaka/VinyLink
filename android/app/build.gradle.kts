import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Dominio de la PWA que abre la app (gradle.properties → twaHost).
val twaHost = providers.gradleProperty("twaHost").get()

// Firma: keystore.properties (no se sube al repo). Sin él, el release sale sin firmar.
val firma = Properties().apply {
    val archivo = rootProject.file("keystore.properties")
    if (archivo.exists()) archivo.inputStream().use(::load)
}

android {
    namespace = "mx.ceti.vinylink"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "mx.ceti.vinylink"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        manifestPlaceholders["twaHost"] = twaHost
        resValue("string", "launchUrl", "https://$twaHost/?origen=app")
        resValue(
            "string",
            "assetStatements",
            """[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"web","site":"https://$twaHost"}}]"""
        )
    }

    buildFeatures {
        resValues = true
    }

    signingConfigs {
        if (firma.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(firma.getProperty("storeFile"))
                storePassword = firma.getProperty("storePassword")
                keyAlias = firma.getProperty("keyAlias")
                keyPassword = firma.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (firma.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.androidbrowserhelper)
}
