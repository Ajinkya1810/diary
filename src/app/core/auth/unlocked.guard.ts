import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { VaultService } from '../vault/vault.service';

export const unlockedGuard: CanActivateFn = () => {
  const vault = inject(VaultService);
  const router = inject(Router);
  if (vault.getKey()) return true;
  return router.createUrlTree(['/lock']);
};
