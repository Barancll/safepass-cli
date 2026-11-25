"""{% sp_icon key size css_class %}: inline SVG from the built-in icon set (safepass/icons.py)"""

from django import template

from ..icons import icon_svg

register = template.Library()


@register.simple_tag
def sp_icon(key, size=20, css_class=''):
    return icon_svg(key, size, css_class)


@register.filter
def get_item(mapping, key):
    """{{ lookup|get_item:card.category }}"""
    if not mapping or key is None:
        return None
    return mapping.get(str(key).lower())


@register.simple_tag
def security_pictures():
    """{% security_pictures as pictures %}: shapes and colours for the security picture picker"""
    from ..pictures import choices
    return choices()
