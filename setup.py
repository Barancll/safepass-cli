import re
from pathlib import Path

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

# Single source of truth: safepass/__init__.py
version = re.search(
    r'^__version__ = "([^"]+)"', Path("safepass/__init__.py").read_text(encoding="utf-8"), re.M
).group(1)

setup(
    name="safepass-cli",
    version=version,
    author="Baran Celal Tonyalı",
    author_email="tonyalibarancelal@gmail.com",
    description="Offline password manager with strong encryption",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/Barancll/safepass-cli",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: End Users/Desktop",
        "Topic :: Security",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
    ],
    python_requires=">=3.10",
    install_requires=[
        "Django>=5.2,<5.3",
        "cryptography>=44.0.0",
    ],
    entry_points={
        "console_scripts": [
            "safepass=safepass.__main__:main",
        ],
    },
    include_package_data=True,
    package_data={
        "safepass": [
            "static/**/*",
            "templates/**/*",
        ],
    },
)
