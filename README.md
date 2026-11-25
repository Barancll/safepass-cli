# SafePass

Şifrelerini yalnızca kendi bilgisayarında saklayan, tarayıcıdan kullanılan çevrimdışı şifre yöneticisi. Hesap açtırmaz, kasandan hiçbir şeyi dışarı göndermez. İnternete kendiliğinden yalnızca yeni sürüm kontrolü için çıkar; bunu da Ayarlar'dan kapatabilirsin.

```bash
pip install safepass-cli
safepass start
```

`safepass start` tarayıcını giriş sayfasında kendisi açar; orada hesabını oluştur. SafePass ana şifreni yalnızca bu komutun açtığı pencerede ister, yer iminden açılan bir sayfa şifre istiyorsa o sayfa SafePass değildir. Python 3.10 veya üstü gerekir.

> ⚠️ **Kurtarma anahtarını sakla.** Kayıtta bir kez gösterilir. Ana şifreni unutursan yalnızca bu anahtarla yeni şifre belirleyebilirsin; ikisini birden kaybedersen verilerine kimse ulaşamaz.

## Neler yapabilir?

**Kasa**
- Her kayıt için başlık, kullanıcı adı, şifre, adres, kategori ve not
- Arama, kategori filtreleri ve değişen şifrelerin geçmişi
- Kullanılmayan hesapları silmeden pasife alma
- 7 gün saklanan çöp kutusu
- Kopyalanan şifrenin panodan otomatik silinmesi

**Güvenlik takibi**
- Gösterge panelinde güvenlik skoru
- Zayıf, tekrar eden ve eskiyen şifrelerin listesi
- Eskiyen şifreler ve hatalı giriş denemeleri için bildirimler
- Yapılandırılabilir şifre üretici
- **Siber Test:** Bir şifreye karşı yapılan saldırıyı beş adımda canlandırır (sızan şifre listesi, sözlük, örüntü, tarih/PIN, kaba kuvvet) ve dört senaryo için tahmini kırılma süresini gösterir. Şifre yazılarak ya da Şifre Üret'teki "Saldırıya karşı test et" ile gönderilir. Hesap tarayıcıda yapılır; şifre denenmez, kaydedilmez, hiçbir yere gönderilmez. Sonuçlar örnek amaçlıdır.

**Düzen ve arayüz**
- Kendi kategorilerini, alt kategorilerini ve hazır servislerini düzenleme
- Sayfanın özelliklerini adım adım anlatan **Yardım** turu (maskotumuz Lokki eşliğinde)
- Açık ve koyu tema, görünüm ayarları
- Türkçe, İngilizce, İspanyolca, Almanca ve Rusça

Arayüz masaüstü tarayıcılar için tasarlandı; telefon ekranlarında menüye ulaşılamıyor.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `safepass start` | Arka planda başlatır ve giriş sayfasını açar (bu kuruluma özel portta) |
| `safepass start --port 8080` | Başka bir portta başlatır |
| `safepass start --foreground` | Bu terminalde çalıştırır, `Ctrl+C` ile durur |
| `safepass stop` | Çalışan sunucuyu durdurur |
| `safepass update` | En son sürüme günceller |
| `safepass rollback` | Geri dönülebilecek sürümleri listeler |
| `safepass rollback 1.2.4` | Daha önce kullandığın bir sürüme döner |
| `safepass reset` | Tüm verileri silip boş bir kasa açar |
| `safepass clean` | SafePass'in tüm verilerini siler |
| `safepass --help` | Yardımı gösterir |

`reset` ve `clean` geri alınamaz; önce silinecek klasörü ve dosyaları gösterir, onay için `delete` yazmanı ister.

**Port:** SafePass ilk başlatıldığında 20000–32000 arasından rastgele bir port seçer ve veri klasöründeki `port` dosyasına yazar; sonraki her başlatmada aynı portu kullanır. Herkesin bildiği sabit bir port olmadığı için bilgisayardaki başka bir programın SafePass kapalıyken o adrese sahte bir giriş sayfası koyması zorlaşır. 2.50.152 ve öncesi hep 2025'i kullanıyordu: güncellemeden sonra adres değişir, eski yer imini sil. Bu geçişte tema, görünüm ayarları ve güvenilir cihaz kaydı da bir kez sıfırlanır, çünkü tarayıcı bunları adrese göre saklar. SafePass'i her zaman `safepass start` ile aç; doğru adresi o açar.

## Güncelleme ve geri dönüş

```bash
safepass stop
safepass update
safepass start
```

Verilerin korunur. Sürüm değişmeden hemen önce veritabanının kopyası alınır ve 30 gün saklanır.

Yeni sürüm çıkınca üst bardaki zil haber verir ve bu komutları gösterir.

**1.x sürümünden geçiyorsan:**
- Verilerin ilk girişte yeni güvenlik biçimine geçirilir, ana şifren değişmez.
- İlk açılışta yenilikler anlatılır. Kurtarma anahtarın olmadığı için onu **Ayarlar**'dan ya da bu turdan oluşturmayı unutma.
- Yeni biçimi eski sürümler okuyamaz. Dönmek istersen `pip` ile eski sürümü kurma, `safepass rollback 1.2.4` komutunu kullan.

**Geri dönüş nasıl çalışır?** `safepass rollback <sürüm>` eski sürümü kurar ve o sürümün kopyasını geri yükler.
- Kopyadan sonra eklediğin veya değiştirdiğin kayıtlar eski sürümde görünmez. Güncel verilerin silinmez, yana kaydedilir.
- Vazgeçersen `safepass update` ve ardından `safepass rollback <yeni sürüm>` ile geri gelir.
- Yalnızca bu bilgisayarda kullandığın ve kopyasının süresi dolmamış sürümlere dönebilirsin.

## Yedekleme ve taşıma

**İçe/Dışa Aktar** sayfasından, ana şifreni girerek dışa aktarabilirsin:

| Biçim | Ne için | Dikkat |
|---|---|---|
| **Şifreli yedek** (`.safepass`) | Yedek almak ve başka bir bilgisayardaki SafePass'e taşımak | Belirlediğin yedek parolasını unutursan dosya açılamaz; kurtarma anahtarı da açmaz |
| **Düz metin JSON** | Başka bir şifre yöneticisine geçmek | Tüm şifrelerin açıkça yazılıdır; işin bitince dosyayı sil |

Yedekten şifreler, notlar, kategoriler ve pasif durumu döner. Şifre geçmişi, tarihler ve çöp kutusu dönmez.

İçe aktarmada `.safepass`, `.json` ve şu sütunlara sahip `.csv` dosyaları kabul edilir:

```text
KeePass:   Group,Subcategory,Title,Username,Password,URL
SafePass:  title,username,password,website,category,subcategory
```

Aynı kayıt yeniden eklenmez. Şifresi değişmiş bir kayıtta yeni şifre yazılır, eskisi geçmişe kaydedilir.

## Güvenlik

- **Şifreleme:** Şifreler, başlıklar, kullanıcı adları, adresler ve notlar AES-256-GCM ile şifrelenir.
- **Ana şifre:** Saklanmaz. Her denemesi 64 MB bellek isteyen Argon2id ile anahtara çevrilir, bu da veritabanı çalınsa bile tahmin etmeyi pahalılaştırır.
- **Kurtarma anahtarı:** Saklanmaz. Değiştiğinde veya ana şifre değiştiğinde eskisi geçersiz olur.
- **Oturum:** Hareketsizlikte kapanır (varsayılan 7 dakika, 5–120 dakika arası seçilebilir). Anahtar yalnızca bellekte, tek bir kopya olarak tutulur. Çıkışta, süre dolunca, ana şifre değişince ve hesap silinince bu kopya sıfırlanır. SafePass kapanınca oturum da biter.
- **Tarayıcı:** İçerik Güvenlik Politikası (CSP) ve CSRF koruması vardır, tekrarlanan hatalı girişlerde hesap geçici olarak kilitlenir.
- **Ağ:** Sunucu varsayılan olarak yalnızca bu bilgisayardan erişilebilir. Yazı tipleri pakete dahildir, sayfalar dışarıya istek göndermez.
- **Sürüm kontrolü:** Giriş yapılmışken günde en fazla bir kez PyPI'a en son sürüm numarası sorulur; kasandan hiçbir şey gönderilmez, ama PyPI IP adresini görür. **Ayarlar**'dan kapatınca SafePass kendiliğinden internete hiç çıkmaz; yalnızca `update` ve `rollback` komutları çıkar.

**Bilmen gerekenler**
- Kategori adları ve Tanımlar'daki servisler veritabanında şifresiz durur.
- Bilgisayarına bulaşmış zararlı bir yazılım, oturumun açıkken şifrelerini görebilir. Hiçbir yerel şifre yöneticisi buna karşı tam koruma sağlamaz.
- SafePass, isteklerin ve yanıtların ham baytlarını işi bitince sıfırlar. Ama Python, metne çevrilmiş kopyaları (ana şifre, açılan kart şifreleri) silmeye izin vermez. Bunlar, üzerlerine başka veri yazılana kadar sunucu belleğinde kalabilir. Bellek dökümü, çökme dökümü veya hazırda bekletme dosyası alabilen biri onları okuyabilir. En temiz yol, işin bitince `safepass stop` ile SafePass'i kapatmaktır.
- 1.x'ten gelen bir hesabın verileri ilk girişe kadar eski, zayıf biçimde kalır. Bu sürümün geri dönüş kopyası da aynı biçimdedir ve 30 gün diskte durur.
- SafePass kişisel bir projedir, bağımsız bir güvenlik denetiminden geçmemiştir.

Verilerin `~/.safepass` klasöründedir. Bu klasörü kopyalamak yedek sayılmaz: içinde 30 günlük sürüm kopyaları da vardır. Yedek için **Şifreli yedek** kullan.

## Sorun giderme

| Sorun | Çözüm |
|---|---|
| Port kullanımda | `safepass start --port 2026` |
| Sayfa açılmıyor | `safepass stop`, ardından `safepass start`; hata sürerse `~/.safepass/safepass.log` dosyasına bak |
| Ana şifremi unuttum | Giriş ekranında **Ana şifremi unuttum**'a tıkla, kurtarma anahtarını gir |
| Kurtarma anahtarımı kaybettim | Ana şifrenle giriş yapıp **Ayarlar**'dan yenisini oluştur |
| Sayfa bozuk görünüyor | Tarayıcıda `Ctrl+F5` ile yenile |
| Eski sürüme geçince "Yanlış şifre" diyor | Yeni sürümü yeniden kurup `safepass rollback <eski sürüm>` komutunu kullan |

## Kaldırma

```bash
safepass clean              # verileri siler (isteğe bağlı, geri alınamaz)
pip uninstall safepass-cli  # uygulamayı kaldırır, verilere dokunmaz
```

## Geliştirme

Kaynak koddan çalıştırmak için:

```bash
git clone https://github.com/Barancll/safepass-cli.git
cd safepass-cli
python -m venv .venv
pip install -r requirements.txt
pip install -e .
safepass start
```

Django 5.2, SQLite ve saf JavaScript ile yazıldı.

## Geliştirici

**Baran Celal Tonyalı** · [Web sitesi](https://barancelaltonyali.com/) · [LinkedIn](https://www.linkedin.com/in/baran-celal-tonyali/) · [GitHub](https://github.com/Barancll) · [PyPI](https://pypi.org/project/safepass-cli/)

## Lisans

[MIT](https://github.com/Barancll/safepass-cli/blob/main/LICENSE). Yazılım hiçbir garanti olmadan sunulur.
