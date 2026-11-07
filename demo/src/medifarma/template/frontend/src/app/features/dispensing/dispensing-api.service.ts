import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { DispensingView } from '../../shared/models/farma.models';

@Injectable({ providedIn: 'root' })
export class DispensingApiService {
  private readonly http = inject(HttpClient);

  dispense(prescriptionId: string): Observable<DispensingView> {
    return this.http.post<DispensingView>(`${API}/prescriptions/${prescriptionId}/dispense`, {});
  }

  list(prescriptionId: string): Observable<DispensingView[]> {
    return this.http.get<DispensingView[]>(`${API}/prescriptions/${prescriptionId}/dispensings`);
  }
}
