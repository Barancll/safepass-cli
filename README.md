# SafePass - Offline Password Manager

SafePass, şifrelerinizi güvenli bir şekilde yerel bilgisayarınızda saklayan offline bir şifre yöneticisidir.

## 🔐 Özellikler

- ✅ **Offline Çalışma**: Tüm veriler yerel bilgisayarınızda
- ✅ **Güçlü Şifreleme**: AES-256-GCM ile şifreleme
- ✅ **Ana Şifre**: Master password ile tüm verilerinizi koruyun
- ✅ **Şifre Üretici**: Güçlü şifreler otomatik oluşturun
- ✅ **Gerçek Zamanlı Şifre Doğrulama**: Kayıt sırasında canlı şifre gücü göstergesi
- ✅ **Güvenlik Analizi**: Şifrelerinizi otomatik değerlendirin
- ✅ **Dashboard**: Gerçek zamanlı güvenlik skoru ve istatistikler
- ✅ **Oturum Timeout**: 1 saat inaktivite sonrası otomatik çıkış
- ✅ **Otomatik Güncelleme Kontrolü**: PyPI üzerinden yeni sürüm bildirimleri
- ✅ **Modern Arayüz**: Responsive tasarım ve toast bildirimleri

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
pip install safepass-cli
```

## 🚀 Kullanım

### İlk Kurulum

Kurulumdan sonra SafePass otomatik olarak varsayılan port olan **2025**'te başlar.

### Komutlar

```bash
# Veritabanını manuel başlat (opsiyonel - start komutu otomatik yapar)
safepass init

# Web sunucusunu başlat (varsayılan port: 2025)
safepass start

# Uygulamayı güncelle
safepass update

# Çalışan sunucuyu durdur
safepass stop

# Tüm verileri sıfırla (GERİ ALINAMAZ!)
safepass reset

# Tüm kullanıcı verilerini ve veritabanını kaldır
safepass clean

# Yardım
safepass --help
```

### Tarayıcıdan Erişim

```
http://localhost:2025
```

## 🎨 Kullanıcı Arayüzü Özellikleri

### Kayıt & Giriş

- **Gerçek Zamanlı Şifre Doğrulama**: Kayıt sırasında şifrenizin gücünü anlık görün
- **Şifre Gereksinimleri Göstergesi**: 
  - ✅ En az 8 karakter
  - ✅ Büyük harf (A-Z)
  - ✅ Küçük harf (a-z)
  - ✅ Rakam (0-9)
  - ✨ Sembol (!@#$%) - isteğe bağlı
- **Şifre Görünürlük Kontrolü**: Göz ikonu ile şifreleri göster/gizle
- **Ana Şifre Uyarısı**: Şifrenizi unutma riskine karşı bilgilendirme

### Bildirimler

- **Toast Bildirimleri**: Sağ üst köşede modern bildirimler
- **Hata Yönetimi**: Detaylı ve kullanıcı dostu hata mesajları
- **Güncelleme Kontrolü**: PyPI üzerinden otomatik sürüm kontrolü

### Yardımcı Butonlar

Sağ alt köşede sabit butonlar:
- **ℹ️ Nasıl Çalışır**: SafePass hakkında detaylı bilgi (sadece kayıt sayfasında)
- **🔔 Güncelleme**: Yeni sürüm mevcut olduğunda görünür
- **❤️ Geliştirici**: Geliştirici bilgileri ve iletişim

## 🗑️ Kaldırma

### Veritabanını Temizle (Şifreleri Sil)

```bash
# Tüm şifrelerinizi ve veritabanını sil
safepass clean
```

⚠️ **Uyarı:** Bu komut tüm şifrelerinizi kalıcı olarak siler!

### Uygulamayı Tamamen Kaldır

```bash
# 1. Önce veritabanını temizle (opsiyonel)
safepass clean

# 2. Uygulamayı kaldır
pip uninstall safepass-cli
```

**Not:** `pip uninstall` sadece uygulamayı kaldırır, verilerinizi silmez. Verilerinizi de silmek için önce `safepass clean` komutunu çalıştırın.

## 🔄 Güncelleme

SafePass, PyPI üzerinden yeni sürümleri otomatik kontrol eder. Yeni bir sürüm mevcut olduğunda:

1. Sağ alt köşede 🔔 güncelleme butonu görünür
2. Butona tıklayarak güncelleme talimatlarını görün
3. Terminalde `safepass update` komutunu çalıştırın
4. Uygulamayı yeniden başlatın

**Manuel Güncelleme:**
```bash
safepass update
# veya
pip install --upgrade safepass-cli
```

## 🎯 Teknolojiler

**Backend:**
- Django 5.1.x
- SQLite
- Python 3.8+

**Frontend:**
- Modern CSS (Gradient tasarımlar, animasyonlar)
- Vanilla JavaScript
- Responsive Design

**Güvenlik:**
- AES-256-GCM şifreleme
- PBKDF2 anahtar türetme
- CSRF koruması

## 🔒 Güvenlik

- Tüm şifreler AES-256-GCM ile şifrelenir
- Ana şifre asla saklanmaz
- Veriler `~/.safepass/` dizininde saklanır
- Offline çalışır, internet bağlantısı gerektirmez (güncelleme kontrolü hariç)
- CSRF token koruması
- Session timeout (1 saat inaktivite)

## ⚙️ Yapılandırma

### Varsayılan Ayarlar

- **Port**: 2025
- **Session Timeout**: 1 saat
- **Veritabanı**: `~/.safepass/db.sqlite3`
- **Otomatik Güncelleme Kontrolü**: Aktif

## ⚠️ Önemli Notlar

- **Ana şifrenizi unutmayın!** Unutursanız verileriniz kurtarılamaz.
- Düzenli olarak verilerinizi yedekleyin (Profil > Veri Dışa Aktar)
- Güçlü ve benzersiz bir ana şifre kullanın
- Ana şifrenizi güvenli bir yerde saklayın
- Uygulamayı güncel tutun (`safepass update`)

## 📱 Tarayıcı Desteği

SafePass modern tarayıcılarda sorunsuz çalışır:
- ✅ Chrome/Edge (önerilen)
- ✅ Firefox
- ✅ Safari
- ✅ Opera

## 🐛 Sorun Giderme

### Veritabanı Hatası
```bash
# Veritabanını sıfırla (VERİLER SİLİNİR!)
safepass clean
```

### Güncelleme Sorunu
```bash
# Manuel güncelleme
pip install --upgrade safepass-cli --force-reinstall
```

## 👨‍💻 Geliştirici

**Baran Celal Tonyalı**

- 🌐 Website: [barancelaltonyali.com](https://barancelaltonyali.com/)
- 💼 LinkedIn: [linkedin.com/in/baran-celal-tonyali](https://www.linkedin.com/in/baran-celal-tonyali/)
- 📦 PyPI: [pypi.org/project/safepass-cli](https://pypi.org/project/safepass-cli/)
- 💻 GitHub: [github.com/Barancll/safepass-cli](https://github.com/Barancll/safepass-cli)

## 📄 Lisans

MIT License - Detaylar için LICENSE dosyasına bakın.

**SafePass v1.1.0** - Made with ❤️ by Baran Celal Tonyalı
