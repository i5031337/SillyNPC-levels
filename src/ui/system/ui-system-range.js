let nextRangeId = 0;

/** Validate an optional numeric range without interrupting editing. */
export function attachRangeValidation(container, minimum, maximum) {
    if (!minimum || !maximum) return;
    const error = document.createElement('small');
    error.className = 'sillynpc-range-error';
    error.id = `sillynpc-range-error-${++nextRangeId}`;
    error.setAttribute('role', 'status');
    error.textContent = 'Min must not exceed Max.';
    container.append(error);
    for (const input of [minimum, maximum]) input.setAttribute('aria-describedby', error.id);
    const validate = () => {
        const min = minimum.value.trim();
        const max = maximum.value.trim();
        const invalid = min !== '' && max !== '' && Number.isFinite(Number(min))
            && Number.isFinite(Number(max)) && Number(min) > Number(max);
        error.hidden = !invalid;
        for (const input of [minimum, maximum]) {
            input.setCustomValidity(invalid ? error.textContent : '');
            if (invalid) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
        }
    };
    minimum.addEventListener('input', validate);
    maximum.addEventListener('input', validate);
    validate();
}
