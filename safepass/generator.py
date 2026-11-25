"""Password generator utilities"""

import secrets
import string


def calculate_password_strength(password: str) -> dict:
    """Calculate password strength score and feedback"""
    score = 0
    feedback = []
    
    # Length check
    length = len(password)
    if length >= 16:
        score += 40
    elif length >= 12:
        score += 30
    elif length >= 8:
        score += 20
    else:
        feedback.append("Şifre çok kısa (minimum 8 karakter)")
    
    # Character variety
    has_lower = any(c.islower() for c in password)
    has_upper = any(c.isupper() for c in password)
    has_digit = any(c.isdigit() for c in password)
    has_symbol = any(c in string.punctuation for c in password)
    
    variety_count = sum([has_lower, has_upper, has_digit, has_symbol])
    score += variety_count * 15
    
    if not has_lower:
        feedback.append("Küçük harf ekleyin")
    if not has_upper:
        feedback.append("Büyük harf ekleyin")
    if not has_digit:
        feedback.append("Rakam ekleyin")
    if not has_symbol:
        feedback.append("Sembol ekleyin")
    
    # Determine strength level
    if score >= 80:
        strength = "strong"
        label = "Güçlü"
    elif score >= 50:
        strength = "medium"
        label = "Orta"
    else:
        strength = "weak"
        label = "Zayıf"
    
    return {
        "score": min(score, 100),
        "strength": strength,
        "label": label,
        "feedback": feedback
    }


# ── PINs ────────────────────────────────────────────────────────────────────
# Short digit-only codes are judged on their own scale: a random 4-digit PIN is
# fine for a phone or a card, a date or 1234 is not.

PIN_MAX_LENGTH = 8

# Most used 4- and 6-digit PINs (leaked-PIN studies); the rest is caught by the pattern checks
COMMON_PINS = {
    '1234', '1111', '0000', '1212', '7777', '1004', '2000', '4444', '2222', '6969', '9999', '3333',
    '5555', '6666', '1122', '1313', '8888', '4321', '2001', '1010', '2580', '0852', '1478', '1236',
    '123456', '111111', '000000', '654321', '121212', '123123', '666666', '112233', '159753', '696969',
    '777777', '888888', '999999', '555555', '147258', '258369', '123321', '102030', '101010', '131313',
}

# Score lost per problem (from the length's starting score)
PIN_PENALTIES = {'repeated': 70, 'sequence': 65, 'common': 65, 'pattern': 50, 'date': 35, 'few_digits': 25}


def is_pin(code: str) -> bool:
    return code.isdigit() and len(code) <= PIN_MAX_LENGTH


def _valid_day_month(day, month):
    return 1 <= month <= 12 and 1 <= day <= 31


def _looks_like_date(pin: str) -> bool:
    """DDMM / MMDD / a year (4 digits), DDMMYY / MMDDYY / YYMMDD (6), DDMMYYYY / YYYYMMDD (8)"""
    n = len(pin)
    if n == 4:
        a, b = int(pin[:2]), int(pin[2:])
        return _valid_day_month(a, b) or _valid_day_month(b, a) or 1940 <= int(pin) <= 2039
    if n == 6:
        x, y, z = int(pin[:2]), int(pin[2:4]), int(pin[4:])
        return _valid_day_month(x, y) or _valid_day_month(y, x) or _valid_day_month(z, y)
    if n == 8:
        return ((_valid_day_month(int(pin[:2]), int(pin[2:4])) and 1900 <= int(pin[4:]) <= 2099)
                or (1900 <= int(pin[:4]) <= 2099 and _valid_day_month(int(pin[6:]), int(pin[4:6]))))
    return False


def pin_issues(pin: str) -> list:
    """Problem codes for a digit-only PIN (empty list = no known weakness)"""
    issues = []
    n = len(pin)
    steps = {int(b) - int(a) for a, b in zip(pin, pin[1:])}
    if len(set(pin)) == 1:
        issues.append('repeated')
    elif steps in ({1}, {-1}):
        issues.append('sequence')
    elif any(n % size == 0 and pin == pin[:size] * (n // size) for size in range(2, n // 2 + 1)):
        issues.append('pattern')  # 1212, 123123, 112112
    if pin in COMMON_PINS:
        issues.append('common')
    if _looks_like_date(pin):
        issues.append('date')
    if not issues and len(set(pin)) <= n // 2:
        issues.append('few_digits')
    return issues


def calculate_pin_strength(pin: str) -> dict:
    """PIN scale: length sets the ceiling (4 digits can't be 'strong'), each problem costs points"""
    n = len(pin)
    issues = pin_issues(pin)
    base = {4: 70, 5: 78, 6: 90, 7: 95}.get(n, 100)
    score = max(0, base - sum(PIN_PENALTIES[i] for i in issues))
    if score >= 85:
        strength = 'strong'
    elif score >= 60:
        strength = 'good'
    elif score >= 40:
        strength = 'medium'
    else:
        strength = 'weak'
    notes = issues + (['short'] if n < 6 else [])
    return {'score': score, 'strength': strength, 'kind': 'pin', 'issues': notes, 'combinations': 10 ** n}


def generate_password(length=16, use_uppercase=True, use_lowercase=True,
                     use_digits=True, use_symbols=True, exclude_similar=False):
    """Generate a random password with specified options"""
    
    # Build character set
    chars = ""
    if use_lowercase:
        chars += string.ascii_lowercase
    if use_uppercase:
        chars += string.ascii_uppercase
    if use_digits:
        chars += string.digits
    if use_symbols:
        chars += string.punctuation
    
    # Exclude similar characters if requested
    if exclude_similar:
        similar = "il1Lo0O"
        chars = "".join(c for c in chars if c not in similar)
    
    # Ensure at least one character set is selected
    if not chars:
        chars = string.ascii_letters + string.digits
    
    # Generate password
    password = "".join(secrets.choice(chars) for _ in range(length))

    # A digit-only PIN is drawn again until it has no known weakness (dates, 1234, 1212 …);
    # about 1 in 4 four-digit draws is rejected, so a few tries are always enough
    if chars == string.digits and length <= PIN_MAX_LENGTH:
        for _ in range(100):
            if not pin_issues(password):
                break
            password = "".join(secrets.choice(chars) for _ in range(length))

    return password
