# 🔐 SafePass - Offline Password Manager

<div align="center">

![SafePass](https://img.shields.io/badge/SafePass-v1.0-6366f1?style=for-the-badge&logo=lock&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10+-blue?style=for-the-badge&logo=python&logoColor=white)
![Django](https://img.shields.io/badge/Django-5.1.15-092e20?style=for-the-badge&logo=django&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**Şifrelerinizi dış tehditlere kapalı, güvenle koruyun.**

</div>

---

## 📋 İçindekiler

- [Özellikler](#-özellikler)
- [Güvenlik Analizi](#-güvenlik-analizi)
- [Kurulum](#-kurulum)
- [Kullanım](#-kullanım)
- [Teknik Detaylar](#-teknik-detaylar)
- [Güvenlik](#-güvenlik)
- [Önemli Notlar](#️-önemli-notlar)

---

## ✨ Özellikler

### 🔒 Güvenlik
- ✅ **Offline Çalışma**: Tüm veriler yerel bilgisayarınızda, hiçbir sunucuya gönderilmez
- ✅ **AES-256-GCM Şifreleme**: Bankalar ve askeri kurumlar tarafından kullanılan şifreleme standardı
- ✅ **PBKDF2 Key Derivation**: 100,000 iterasyon ile güçlendirilmiş anahtar türetme
- ✅ **Master Password**: Ana şifre hiçbir yerde saklanmaz, sadece siz bilirsiniz
- ✅ **Session Timeout**: 1 saat inaktivite sonrası otomatik çıkış

### 💼 Yönetim
- ✅ **Şifre Kartları**: Her hesap için ayrı kart (uygulama adı, kullanıcı adı, şifre, URL, notlar)
- ✅ **Kategori Sistemi**: Şifrelerinizi kategorilere ayırın (Genel, İş, Sosyal Medya, vb.)
- ✅ **Şifre Üretici**: Özelleştirilebilir güçlü şifre üretimi (uzunluk, karakter tipleri)
- ✅ **Arama ve Filtreleme**: Şifrelerinizi hızlıca bulun
- ✅ **Düzenleme ve Silme**: Kartlarınızı kolayca güncelleyin

### 📊 Analiz ve Raporlama
- ✅ **Dashboard**: Gerçek zamanlı güvenlik skoru ve istatistikler
- ✅ **Güvenlik Analizi**: Her şifre otomatik olarak değerlendirilir (Güçlü/Orta/Zayıf)
- ✅ **Tekrar Eden Şifre Tespiti**: Aynı şifreyi kullanan hesapları gösterir
- ✅ **Şifre Gücü Göstergesi**: Canlı güç hesaplama ve renk kodlu gösterim

### 💾 Yedekleme ve Taşıma
- ✅ **Veri Dışa Aktarma**: Tüm şifrelerinizi JSON formatında dışa aktarın
- ✅ **Veri İçe Aktarma**: Backup dosyalarınızı geri yükleyin
- ✅ **Duplicate Kontrolü**: İçe aktarma sırasında tekrar eden kayıtları atlar

### ⚙️ Profil Yönetimi
- ✅ **Master Şifre Değiştirme**: Ana şifrenizi güvenle değiştirin (tüm şifreler otomatik yeniden şifrelenir)
- ✅ **Hesap İstatistikleri**: Toplam şifre, ortalama güvenlik skoru
- ✅ **Hesap Silme**: Onaylı hesap silme (üç aşamalı güvenlik)

### 🎨 Arayüz
- ✅ **Modern Tasarım**: Gradient renkler, blur efektleri, animasyonlar
- ✅ **Responsive**: 13-14" laptop optimizasyonu dahil tüm ekran boyutları
- ✅ **Dark Theme**: Gözleri yormayan karanlık tema
- ✅ **Kolay Navigasyon**: Sidebar menü ile hızlı erişim

## 📊 Güvenlik Analizi

SafePass, şifrelerinizi otomatik olarak analiz eder ve güvenlik seviyenizi değerlendirir.

### Şifre Gücü Kategorileri

Şifreler üç kategoriye ayrılır:
- **🛡️ Güçlü** (80+ puan): Uzun, çeşitli karakter içeren şifreler
- **⚠️ Orta** (50-79 puan): İyileştirilebilir şifreler
- **🔴 Zayıf** (<50 puan): Acilen değiştirilmesi gereken şifreler

### Şifre Puanlama Sistemi

Her şifre aşağıdaki kriterlere göre 100 üzerinden puanlanır:

**Uzunluk Puanı:**
- 16+ karakter → 40 puan
- 12-15 karakter → 30 puan
- 8-11 karakter → 20 puan
- 8'den az → 0 puan

**Karakter Çeşitliliği** (her biri +15 puan):
- ✓ Küçük harf (a-z)
- ✓ Büyük harf (A-Z)
- ✓ Rakam (0-9)
- ✓ Sembol (!@#$%...)

**Örnek Hesaplamalar:**
```
"password"         → 20 + 15 = 35 puan  (Zayıf)
"Password123"      → 30 + 45 = 75 puan  (Orta)
"P@ssw0rd!2024"    → 30 + 60 = 90 puan  (Güçlü)
"MyS3cur3P@ss!"    → 30 + 60 = 90 puan  (Güçlü)
"C0mpl3x!P@ssW0rd" → 40 + 60 = 100 puan (Güçlü)
```

### Güvenlik Skoru

Dashboard'daki güvenlik skoru, tüm şifrelerinizi değerlendirerek hesaplanır:

```
Başlangıç: 100 puan
- Her zayıf şifre için: -2 puan
- Her orta şifre için: -1 puan  
- Her tekrarlanan şifre için: -3 puan
Sonuç: 0-100 arası güvenlik skoru
```

**Tekrar Eden Şifreler:**
Birden fazla hesap için aynı şifreyi kullanmak büyük güvenlik riski oluşturur. Bir hesap ele geçirildiğinde diğer hesaplarınız da tehlikeye girer. Bu yüzden:
- Aynı şifreyi 2 hesapta kullanmak → -3 puan
- Aynı şifreyi 3 hesapta kullanmak → -6 puan
- vb.

Dashboard'da "Tekrar Eden Şifreler" bölümünde hangi şifrelerin tekrarlandığını görebilirsiniz.

**Skor Yorumlama:**
- 90-100: Mükemmel güvenlik 🏆
- 75-89: İyi güvenlik ✅
- 50-74: Orta güvenlik ⚠️
- 0-49: Zayıf güvenlik 🚨

### Dashboard İstatistikleri

Ana sayfada şu bilgileri görebilirsiniz:
- 📊 Toplam şifre sayısı
- 🛡️ Güçlü şifre sayısı
- ⚠️ Orta şifre sayısı
- 🔴 Zayıf şifre sayısı
- 🔒 Genel güvenlik skoru (0-100)
- 📋 Son eklenen şifreler

## 📦 Kurulum

```bash
pip install safepass
```

## 🚀 Kullanım

### İlk Kurulum
```bash
safepass init
```

### Uygulamayı Başlatma
```bash
safepass start
```

Tarayıcınızda `http://localhost:8000` adresine gidin.

### Diğer Komutlar
```bash
# Ana şifreyi sıfırla (TÜM VERİLER SİLİNİR!)
safepass reset

# Yardım
safepass --help
```

## 🔒 Güvenlik

- Tüm şifreler AES-256-GCM ile şifrelenir
- Ana şifre asla saklanmaz
- Veriler `~/.safepass/` dizininde saklanır
- Offline çalışır, internet bağlantısı gerektirmez

## ⚠️ Önemli Notlar

- **Ana şifrenizi unutmayın!** Unutursanız verileriniz kurtarılamaz.
- Düzenli olarak verilerinizi yedekleyin (Profil > Veri Dışa Aktar)

## 📝 Lisans

MIT License

## 🤝 Katkıda Bulunma

Pull request'ler kabul edilir. Büyük değişiklikler için lütfen önce bir issue açın.
