export function unwrapSupabase(result, context = 'Supabase request failed') {
  if (result.error) {
    const error = new Error(`${context}: ${result.error.message}`);
    error.code = result.error.code;
    error.cause = result.error;
    throw error;
  }

  return result.data;
}
